use crate::sam2_diagnostics::{Recorder, RuntimeDiagnostics, runtime_recorder, take_diagnostics};
use napi::{
    Task,
    bindgen_prelude::{AsyncTask, Float32Array, Int32Array, Uint8Array},
};
use napi_derive::napi;
use ort::{
    session::Session,
    value::{DynTensor, Tensor},
};
use std::{
    collections::HashMap,
    sync::{Arc, mpsc},
};

/// CPU-only ONNX sessions compiled from hash-verified bytes owned by the
/// caller. The daemon keeps this object alive and separately caches the
/// prompt-independent encoder result.
pub struct Sam2CpuRuntime {
    encoder: Session,
    decoder: Session,
}

impl Sam2CpuRuntime {
    fn from_bytes(
        encoder: &[u8],
        decoder: &[u8],
        recorder: &Arc<Recorder>,
    ) -> Result<Self, String> {
        runtime_recorder();
        let encoder = cpu_session(encoder, recorder)
            .map_err(|error| format!("invalid SAM encoder: {error}"))?;
        let decoder = cpu_session(decoder, recorder)
            .map_err(|error| format!("invalid SAM decoder: {error}"))?;
        Ok(Self { encoder, decoder })
    }

    pub fn encoder_input_names(&self) -> Vec<&str> {
        self.encoder
            .inputs()
            .iter()
            .map(|input| input.name())
            .collect()
    }

    pub fn decoder_input_names(&self) -> Vec<&str> {
        self.decoder
            .inputs()
            .iter()
            .map(|input| input.name())
            .collect()
    }

    pub fn run_encoder_f32(
        &mut self,
        inputs: Vec<Sam2Input>,
        outputs: &[String],
    ) -> Result<Vec<Sam2F32Output>, String> {
        run_f32(&mut self.encoder, inputs, outputs)
    }

    pub fn run_decoder_f32(
        &mut self,
        inputs: Vec<Sam2Input>,
        outputs: &[String],
    ) -> Result<Vec<Sam2F32Output>, String> {
        run_f32(&mut self.decoder, inputs, outputs)
    }
}

pub struct Sam2Input {
    pub name: String,
    pub dimensions: Vec<u32>,
    pub data: Sam2TensorData,
}

pub enum Sam2TensorData {
    F32(Vec<f32>),
    I32(Vec<i32>),
}

pub struct Sam2F32Output {
    pub dimensions: Vec<u32>,
    pub data: Vec<f32>,
}

fn run_f32(
    session: &mut Session,
    inputs: Vec<Sam2Input>,
    requested: &[String],
) -> Result<Vec<Sam2F32Output>, String> {
    let mut tensors = HashMap::<String, DynTensor>::new();
    for input in inputs {
        let dimensions: Vec<i64> = input.dimensions.into_iter().map(i64::from).collect();
        let tensor = match input.data {
            Sam2TensorData::F32(data) => Tensor::from_array((dimensions, data))
                .map_err(|error| error.to_string())?
                .upcast(),
            Sam2TensorData::I32(data) => Tensor::from_array((dimensions, data))
                .map_err(|error| error.to_string())?
                .upcast(),
        };
        if tensors.insert(input.name, tensor).is_some() {
            return Err("duplicate SAM tensor input".to_owned());
        }
    }
    // Outputs may alias inputs (Identity is one example); retain owned input buffers until copied.
    let inputs: Vec<_> = tensors
        .iter()
        .map(|(name, tensor)| (name.as_str(), tensor))
        .collect();
    let outputs = session.run(inputs).map_err(|error| error.to_string())?;
    requested
        .iter()
        .map(|output| {
            if !outputs.contains_key(output) {
                return Err(format!("SAM model did not return {output}"));
            }
            let (dimensions, data) = outputs[output.as_str()]
                .try_extract_tensor::<f32>()
                .map_err(|error| error.to_string())?;
            Ok(Sam2F32Output {
                dimensions: dimensions.iter().map(|value| *value as u32).collect(),
                data: data.to_vec(),
            })
        })
        .collect()
}

fn cpu_session(bytes: &[u8], recorder: &Arc<Recorder>) -> ort::Result<Session> {
    Session::builder()?
        .with_logger(recorder.logger())?
        .with_log_level(ort::logging::LogLevel::Warning)?
        .with_intra_threads(1)?
        .with_inter_threads(1)?
        .with_no_environment_execution_providers()?
        .commit_from_memory(bytes)
}

#[derive(Clone, Copy)]
pub struct Sam2LogitMapping {
    pub model_size: u32,
    pub resized_width: u32,
    pub resized_height: u32,
    pub offset_x: u32,
    pub offset_y: u32,
    pub base_width: u32,
    pub base_height: u32,
    pub base_to_model: Option<[f64; 6]>,
}

/// Bilinearly samples decoder logits through the inverse letterbox and applies
/// SAM's zero-logit threshold directly into base mask coordinates.
pub fn mask_from_sam2_logits(
    logits: &[f32],
    logit_width: u32,
    logit_height: u32,
    mapping: Sam2LogitMapping,
) -> Result<Vec<f32>, String> {
    if logit_width == 0
        || logit_height == 0
        || mapping.model_size == 0
        || mapping.resized_width == 0
        || mapping.resized_height == 0
        || mapping.base_width == 0
        || mapping.base_height == 0
        || mapping
            .base_to_model
            .is_some_and(|matrix| matrix.iter().any(|v| !v.is_finite()))
        || logits.len() != (logit_width as usize) * (logit_height as usize)
    {
        return Err("invalid SAM logit dimensions".to_owned());
    }
    let mut mask = vec![0.0; mapping.base_width as usize * mapping.base_height as usize];
    for y in 0..mapping.base_height {
        for x in 0..mapping.base_width {
            let mut model_x = mapping.offset_x as f32
                + (x as f32 + 0.5) * mapping.resized_width as f32 / mapping.base_width as f32;
            let mut model_y = mapping.offset_y as f32
                + (y as f32 + 0.5) * mapping.resized_height as f32 / mapping.base_height as f32;
            if let Some(m) = mapping.base_to_model {
                let px = x as f64 + 0.5;
                let py = y as f64 + 0.5;
                model_x = (m[0] * px + m[2] * py + m[4]) as f32;
                model_y = (m[1] * px + m[3] * py + m[5]) as f32;
            }
            if model_x < mapping.offset_x as f32
                || model_y < mapping.offset_y as f32
                || model_x >= (mapping.offset_x + mapping.resized_width) as f32
                || model_y >= (mapping.offset_y + mapping.resized_height) as f32
            {
                continue;
            }
            let logit_x = model_x * logit_width as f32 / mapping.model_size as f32 - 0.5;
            let logit_y = model_y * logit_height as f32 / mapping.model_size as f32 - 0.5;
            let value = bilinear(logits, logit_width, logit_height, logit_x, logit_y);
            mask[(y * mapping.base_width + x) as usize] = if value > 0.0 { 1.0 } else { 0.0 };
        }
    }
    Ok(mask)
}

fn bilinear(data: &[f32], width: u32, height: u32, x: f32, y: f32) -> f32 {
    let x = x.clamp(0.0, width.saturating_sub(1) as f32);
    let y = y.clamp(0.0, height.saturating_sub(1) as f32);
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;
    let sample = |px: u32, py: u32| data[(py * width + px) as usize];
    let top = sample(x0, y0) * (1.0 - tx) + sample(x1, y0) * tx;
    let bottom = sample(x0, y1) * (1.0 - tx) + sample(x1, y1) * tx;
    top * (1.0 - ty) + bottom * ty
}

#[napi]
pub struct Sam2OnnxRuntime {
    inner: Arc<Sam2Worker>,
}

struct Sam2Job {
    inputs: Vec<Sam2Input>,
    outputs: Vec<String>,
    decoder: bool,
    reply: mpsc::SyncSender<Sam2RunOutcome>,
}

pub struct Sam2RunOutcome {
    result: Result<Vec<Sam2F32Output>, String>,
    diagnostics: RuntimeDiagnostics,
}

struct Sam2Worker {
    jobs: mpsc::SyncSender<Sam2Job>,
    encoder_inputs: Vec<String>,
    decoder_inputs: Vec<String>,
}

impl Sam2Worker {
    fn new(encoder: Vec<u8>, decoder: Vec<u8>, recorder: Arc<Recorder>) -> Result<Self, String> {
        let (jobs, incoming) = mpsc::sync_channel::<Sam2Job>(1);
        let (ready, initialized) = mpsc::sync_channel(1);
        // Keep inference allocations on one thread: libuv worker rotation retains
        // separate large allocator working sets even when a mutex serializes runs.
        std::thread::Builder::new()
            .name("photoctl-sam".into())
            .spawn(move || {
                let mut runtime = match Sam2CpuRuntime::from_bytes(&encoder, &decoder, &recorder) {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = ready.send(Err(error));
                        return;
                    }
                };
                drop(encoder);
                drop(decoder);
                let names = (
                    runtime
                        .encoder_input_names()
                        .into_iter()
                        .map(str::to_owned)
                        .collect(),
                    runtime
                        .decoder_input_names()
                        .into_iter()
                        .map(str::to_owned)
                        .collect(),
                );
                if ready.send(Ok(names)).is_err() {
                    return;
                }
                for job in incoming {
                    let result = if job.decoder {
                        runtime.run_decoder_f32(job.inputs, &job.outputs)
                    } else {
                        runtime.run_encoder_f32(job.inputs, &job.outputs)
                    };
                    let _ = job.reply.send(Sam2RunOutcome {
                        result,
                        diagnostics: take_diagnostics(&recorder),
                    });
                }
            })
            .map_err(|error| error.to_string())?;
        let (encoder_inputs, decoder_inputs) =
            initialized.recv().map_err(|error| error.to_string())??;
        Ok(Self {
            jobs,
            encoder_inputs,
            decoder_inputs,
        })
    }
}

#[napi(object)]
pub struct Sam2TensorInput {
    pub name: String,
    pub dimensions: Vec<u32>,
    pub f32_data: Option<Float32Array>,
    pub i32_data: Option<Int32Array>,
}

#[napi(object)]
pub struct Sam2TensorOutput {
    pub dimensions: Vec<u32>,
    pub data: Float32Array,
}

#[napi(object, object_from_js = false)]
pub struct Sam2RuntimeCreation {
    pub runtime: Option<Sam2OnnxRuntime>,
    pub error: Option<String>,
    pub diagnostics: RuntimeDiagnostics,
}

#[napi(object)]
pub struct Sam2TensorOutcome {
    pub tensors: Option<Vec<Sam2TensorOutput>>,
    pub error: Option<String>,
    pub diagnostics: RuntimeDiagnostics,
}

#[napi]
pub fn create_sam2_onnx_runtime(encoder: Uint8Array, decoder: Uint8Array) -> Sam2RuntimeCreation {
    let recorder = Recorder::new("session");
    let result = Sam2Worker::new(encoder.to_vec(), decoder.to_vec(), Arc::clone(&recorder));
    let diagnostics = take_diagnostics(&recorder);
    match result {
        Ok(inner) => Sam2RuntimeCreation {
            runtime: Some(Sam2OnnxRuntime {
                inner: Arc::new(inner),
            }),
            error: None,
            diagnostics,
        },
        Err(error) => Sam2RuntimeCreation {
            runtime: None,
            error: Some(error),
            diagnostics,
        },
    }
}

#[napi]
impl Sam2OnnxRuntime {
    #[napi]
    pub fn encoder_input_names(&self) -> Vec<String> {
        self.inner.encoder_inputs.clone()
    }

    #[napi]
    pub fn decoder_input_names(&self) -> Vec<String> {
        self.inner.decoder_inputs.clone()
    }

    #[napi]
    pub fn run_encoder(
        &self,
        inputs: Vec<Sam2TensorInput>,
        outputs: Vec<String>,
    ) -> napi::Result<AsyncTask<Sam2RunTask>> {
        Ok(AsyncTask::new(Sam2RunTask {
            runtime: Arc::clone(&self.inner),
            inputs: to_native_inputs(inputs)?,
            outputs,
            decoder: false,
        }))
    }

    #[napi]
    pub fn run_decoder(
        &self,
        inputs: Vec<Sam2TensorInput>,
        outputs: Vec<String>,
    ) -> napi::Result<AsyncTask<Sam2RunTask>> {
        Ok(AsyncTask::new(Sam2RunTask {
            runtime: Arc::clone(&self.inner),
            inputs: to_native_inputs(inputs)?,
            outputs,
            decoder: true,
        }))
    }
}

pub struct Sam2RunTask {
    runtime: Arc<Sam2Worker>,
    inputs: Vec<Sam2Input>,
    outputs: Vec<String>,
    decoder: bool,
}

impl Task for Sam2RunTask {
    type Output = Sam2RunOutcome;
    type JsValue = Sam2TensorOutcome;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let (reply, result) = mpsc::sync_channel(1);
        self.runtime
            .jobs
            .send(Sam2Job {
                inputs: std::mem::take(&mut self.inputs),
                outputs: std::mem::take(&mut self.outputs),
                decoder: self.decoder,
                reply,
            })
            .map_err(|error| napi::Error::from_reason(error.to_string()))?;
        result
            .recv()
            .map_err(|error| napi::Error::from_reason(error.to_string()))
    }

    fn resolve(&mut self, _env: napi::Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        let diagnostics = output.diagnostics;
        let tensors = match output.result {
            Err(error) => {
                return Ok(Sam2TensorOutcome {
                    tensors: None,
                    error: Some(error),
                    diagnostics,
                });
            }
            Ok(tensors) => tensors,
        };
        Ok(Sam2TensorOutcome {
            tensors: Some(
                tensors
                    .into_iter()
                    .map(|output| Sam2TensorOutput {
                        dimensions: output.dimensions,
                        data: output.data.into(),
                    })
                    .collect(),
            ),
            error: None,
            diagnostics,
        })
    }
}

fn to_native_inputs(inputs: Vec<Sam2TensorInput>) -> napi::Result<Vec<Sam2Input>> {
    inputs
        .into_iter()
        .map(|input| {
            let data = match (input.f32_data, input.i32_data) {
                (Some(data), None) => Sam2TensorData::F32(data.to_vec()),
                (None, Some(data)) => Sam2TensorData::I32(data.to_vec()),
                _ => {
                    return Err(napi::Error::from_reason(
                        "SAM input requires exactly one typed data array",
                    ));
                }
            };
            Ok(Sam2Input {
                name: input.name,
                dimensions: input.dimensions,
                data,
            })
        })
        .collect()
}

#[napi]
pub fn sam2_mask_from_logits(
    logits: Float32Array,
    logit_width: u32,
    logit_height: u32,
    model_size: u32,
    resized_width: u32,
    resized_height: u32,
    offset_x: u32,
    offset_y: u32,
    base_width: u32,
    base_height: u32,
    base_to_model: Option<Vec<f64>>,
) -> napi::Result<Float32Array> {
    let base_to_model = base_to_model
        .map(|matrix| {
            matrix.try_into().map_err(|_| {
                napi::Error::from_reason("SAM projection requires six affine coefficients")
            })
        })
        .transpose()?;
    mask_from_sam2_logits(
        &logits,
        logit_width,
        logit_height,
        Sam2LogitMapping {
            model_size,
            resized_width,
            resized_height,
            offset_x,
            offset_y,
            base_width,
            base_height,
            base_to_model,
        },
    )
    .map(Into::into)
    .map_err(napi::Error::from_reason)
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDENTITY_ONNX: &[u8] = &[
        0x08, 0x0a, 0x12, 0x0c, 0x62, 0x61, 0x63, 0x6b, 0x65, 0x6e, 0x64, 0x2d, 0x74, 0x65, 0x73,
        0x74, 0x3a, 0x5b, 0x0a, 0x10, 0x0a, 0x01, 0x78, 0x12, 0x01, 0x79, 0x22, 0x08, 0x49, 0x64,
        0x65, 0x6e, 0x74, 0x69, 0x74, 0x79, 0x12, 0x0d, 0x74, 0x65, 0x73, 0x74, 0x5f, 0x69, 0x64,
        0x65, 0x6e, 0x74, 0x69, 0x74, 0x79, 0x5a, 0x1b, 0x0a, 0x01, 0x78, 0x12, 0x16, 0x0a, 0x14,
        0x08, 0x01, 0x12, 0x10, 0x0a, 0x02, 0x08, 0x01, 0x0a, 0x02, 0x08, 0x01, 0x0a, 0x02, 0x08,
        0x02, 0x0a, 0x02, 0x08, 0x02, 0x62, 0x1b, 0x0a, 0x01, 0x79, 0x12, 0x16, 0x0a, 0x14, 0x08,
        0x01, 0x12, 0x10, 0x0a, 0x02, 0x08, 0x01, 0x0a, 0x02, 0x08, 0x01, 0x0a, 0x02, 0x08, 0x02,
        0x0a, 0x02, 0x08, 0x02, 0x42, 0x04, 0x0a, 0x00, 0x10, 0x15,
    ];

    #[test]
    fn returns_multiple_requested_outputs_from_one_session_run() {
        // Add the graph input as a second named output beside the Identity node's output.
        let graph_tag = IDENTITY_ONNX.iter().position(|byte| *byte == 0x3a).unwrap();
        let graph_end = graph_tag + 2 + IDENTITY_ONNX[graph_tag + 1] as usize;
        let mut second_output = IDENTITY_ONNX[graph_end - 29..graph_end].to_vec();
        second_output[4] = b'x';
        let mut model = IDENTITY_ONNX.to_vec();
        model.splice(graph_end..graph_end, second_output);
        model[graph_tag + 1] += 29;
        let mut runtime =
            Sam2CpuRuntime::from_bytes(&model, IDENTITY_ONNX, &Recorder::new("session")).unwrap();
        let outputs = runtime
            .run_encoder_f32(
                vec![Sam2Input {
                    name: "x".into(),
                    dimensions: vec![1, 1, 2, 2],
                    data: Sam2TensorData::F32(vec![2.0, 4.0, 6.0, 8.0]),
                }],
                &["y".into(), "x".into()],
            )
            .unwrap();
        assert_eq!(outputs.len(), 2);
        assert_eq!(outputs[0].data, vec![2.0, 4.0, 6.0, 8.0]);
        assert_eq!(outputs[1].data, outputs[0].data);
    }

    #[test]
    fn constructs_cpu_sessions_from_caller_supplied_onnx_bytes() {
        let model = IDENTITY_ONNX;
        let mut runtime = Sam2CpuRuntime::from_bytes(model, model, &Recorder::new("session"))
            .expect("valid test ONNX");
        assert_eq!(runtime.encoder_input_names(), ["x"]);
        assert_eq!(runtime.decoder_input_names(), ["x"]);
        let output = runtime
            .run_decoder_f32(
                vec![Sam2Input {
                    name: "x".to_owned(),
                    dimensions: vec![1, 1, 2, 2],
                    data: Sam2TensorData::F32(vec![1.0, 2.0, 3.0, 4.0]),
                }],
                &["y".into()],
            )
            .expect("decoder executes");
        assert_eq!(output[0].dimensions, [1, 1, 2, 2]);
        assert_eq!(output[0].data, [1.0, 2.0, 3.0, 4.0]);
        assert!(Sam2CpuRuntime::from_bytes(b"not ONNX", model, &Recorder::new("session")).is_err());
    }

    #[test]
    fn upsamples_logits_and_thresholds_at_zero_in_base_coordinates() {
        let mapping = Sam2LogitMapping {
            model_size: 2,
            resized_width: 2,
            resized_height: 2,
            offset_x: 0,
            offset_y: 0,
            base_width: 2,
            base_height: 2,
            base_to_model: None,
        };
        assert_eq!(
            mask_from_sam2_logits(&[-1.0, 1.0, -0.25, 0.25], 2, 2, mapping).unwrap(),
            [0.0, 1.0, 0.0, 1.0]
        );
    }
}
