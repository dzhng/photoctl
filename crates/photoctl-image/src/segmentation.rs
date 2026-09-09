use crate::segmentation_diagnostics::{
    Recorder, RuntimeDiagnostics, runtime_recorder, take_diagnostics,
};
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
pub struct SegmentationCpuRuntime {
    encoder: Session,
    decoder: Session,
}

impl SegmentationCpuRuntime {
    fn from_bytes(
        encoder: &[u8],
        decoder: &[u8],
        recorder: &Arc<Recorder>,
    ) -> Result<Self, String> {
        runtime_recorder();
        let encoder = cpu_session(encoder, recorder)
            .map_err(|error| format!("invalid segmentation encoder: {error}"))?;
        let decoder = cpu_session(decoder, recorder)
            .map_err(|error| format!("invalid segmentation decoder: {error}"))?;
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
        inputs: Vec<SegmentationInput>,
        outputs: &[String],
    ) -> Result<Vec<SegmentationF32Output>, String> {
        run_f32(&mut self.encoder, inputs, outputs)
    }

    pub fn run_decoder_f32(
        &mut self,
        inputs: Vec<SegmentationInput>,
        outputs: &[String],
    ) -> Result<Vec<SegmentationF32Output>, String> {
        run_f32(&mut self.decoder, inputs, outputs)
    }
}

pub struct SegmentationInput {
    pub name: String,
    pub dimensions: Vec<u32>,
    pub data: SegmentationTensorData,
}

pub enum SegmentationTensorData {
    F32(Vec<f32>),
    I32(Vec<i32>),
}

pub struct SegmentationF32Output {
    pub dimensions: Vec<u32>,
    pub data: Vec<f32>,
}

fn run_f32(
    session: &mut Session,
    inputs: Vec<SegmentationInput>,
    requested: &[String],
) -> Result<Vec<SegmentationF32Output>, String> {
    let mut tensors = HashMap::<String, DynTensor>::new();
    for input in inputs {
        let dimensions: Vec<i64> = input.dimensions.into_iter().map(i64::from).collect();
        let tensor = match input.data {
            SegmentationTensorData::F32(data) => Tensor::from_array((dimensions, data))
                .map_err(|error| error.to_string())?
                .upcast(),
            SegmentationTensorData::I32(data) => Tensor::from_array((dimensions, data))
                .map_err(|error| error.to_string())?
                .upcast(),
        };
        if tensors.insert(input.name, tensor).is_some() {
            return Err("duplicate segmentation tensor input".to_owned());
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
                return Err(format!("segmentation model did not return {output}"));
            }
            let (dimensions, data) = outputs[output.as_str()]
                .try_extract_tensor::<f32>()
                .map_err(|error| error.to_string())?;
            Ok(SegmentationF32Output {
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
        .with_intra_threads(4)?
        .with_inter_threads(1)?
        .with_no_environment_execution_providers()?
        .commit_from_memory(bytes)
}

#[napi]
pub struct SegmentationRuntime {
    inner: Arc<SegmentationWorker>,
}

struct SegmentationJob {
    inputs: Vec<SegmentationInput>,
    outputs: Vec<String>,
    decoder: bool,
    reply: mpsc::SyncSender<SegmentationRunOutcome>,
}

pub struct SegmentationRunOutcome {
    result: Result<Vec<SegmentationF32Output>, String>,
    diagnostics: RuntimeDiagnostics,
}

struct SegmentationWorker {
    jobs: Option<mpsc::SyncSender<SegmentationJob>>,
    thread: Option<std::thread::JoinHandle<()>>,
    encoder_inputs: Vec<String>,
    decoder_inputs: Vec<String>,
}

impl SegmentationWorker {
    fn new(encoder: Vec<u8>, decoder: Vec<u8>, recorder: Arc<Recorder>) -> Result<Self, String> {
        let (jobs, incoming) = mpsc::sync_channel::<SegmentationJob>(1);
        let (ready, initialized) = mpsc::sync_channel(1);
        // Keep inference allocations on one thread: libuv worker rotation retains
        // separate large allocator working sets even when a mutex serializes runs.
        let thread = std::thread::Builder::new()
            .name("photoctl-segmentation".into())
            .spawn(move || {
                let mut runtime =
                    match SegmentationCpuRuntime::from_bytes(&encoder, &decoder, &recorder) {
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
                    let _ = job.reply.send(SegmentationRunOutcome {
                        result,
                        diagnostics: take_diagnostics(&recorder),
                    });
                }
            })
            .map_err(|error| error.to_string())?;
        let mut worker = Self {
            jobs: Some(jobs),
            thread: Some(thread),
            encoder_inputs: Vec::new(),
            decoder_inputs: Vec::new(),
        };
        (worker.encoder_inputs, worker.decoder_inputs) =
            initialized.recv().map_err(|error| error.to_string())??;
        Ok(worker)
    }
}

impl Drop for SegmentationWorker {
    fn drop(&mut self) {
        // Sessions must finish releasing ORT before process-level C++ teardown.
        // Close the queue first so an idle worker can exit, then wait for it.
        drop(self.jobs.take());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[napi(object)]
pub struct SegmentationTensorInput {
    pub name: String,
    pub dimensions: Vec<u32>,
    pub f32_data: Option<Float32Array>,
    pub i32_data: Option<Int32Array>,
}

#[napi(object)]
pub struct SegmentationTensorOutput {
    pub dimensions: Vec<u32>,
    pub data: Float32Array,
}

#[napi(object, object_from_js = false)]
pub struct SegmentationRuntimeCreation {
    pub runtime: Option<SegmentationRuntime>,
    pub error: Option<String>,
    pub diagnostics: RuntimeDiagnostics,
}

#[napi(object)]
pub struct SegmentationTensorOutcome {
    pub tensors: Option<Vec<SegmentationTensorOutput>>,
    pub error: Option<String>,
    pub diagnostics: RuntimeDiagnostics,
}

#[napi]
pub fn create_segmentation_runtime(
    encoder: Uint8Array,
    decoder: Uint8Array,
) -> SegmentationRuntimeCreation {
    let recorder = Recorder::new("session");
    let result = SegmentationWorker::new(encoder.to_vec(), decoder.to_vec(), Arc::clone(&recorder));
    let diagnostics = take_diagnostics(&recorder);
    match result {
        Ok(inner) => SegmentationRuntimeCreation {
            runtime: Some(SegmentationRuntime {
                inner: Arc::new(inner),
            }),
            error: None,
            diagnostics,
        },
        Err(error) => SegmentationRuntimeCreation {
            runtime: None,
            error: Some(error),
            diagnostics,
        },
    }
}

#[napi]
impl SegmentationRuntime {
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
        inputs: Vec<SegmentationTensorInput>,
        outputs: Vec<String>,
    ) -> napi::Result<AsyncTask<SegmentationRunTask>> {
        Ok(AsyncTask::new(SegmentationRunTask {
            runtime: Arc::clone(&self.inner),
            inputs: to_native_inputs(inputs)?,
            outputs,
            decoder: false,
        }))
    }

    #[napi]
    pub fn run_decoder(
        &self,
        inputs: Vec<SegmentationTensorInput>,
        outputs: Vec<String>,
    ) -> napi::Result<AsyncTask<SegmentationRunTask>> {
        Ok(AsyncTask::new(SegmentationRunTask {
            runtime: Arc::clone(&self.inner),
            inputs: to_native_inputs(inputs)?,
            outputs,
            decoder: true,
        }))
    }
}

pub struct SegmentationRunTask {
    runtime: Arc<SegmentationWorker>,
    inputs: Vec<SegmentationInput>,
    outputs: Vec<String>,
    decoder: bool,
}

impl Task for SegmentationRunTask {
    type Output = SegmentationRunOutcome;
    type JsValue = SegmentationTensorOutcome;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let (reply, result) = mpsc::sync_channel(1);
        self.runtime
            .jobs
            .as_ref()
            .expect("a live segmentation task owns its worker")
            .send(SegmentationJob {
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
                return Ok(SegmentationTensorOutcome {
                    tensors: None,
                    error: Some(error),
                    diagnostics,
                });
            }
            Ok(tensors) => tensors,
        };
        Ok(SegmentationTensorOutcome {
            tensors: Some(
                tensors
                    .into_iter()
                    .map(|output| SegmentationTensorOutput {
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

fn to_native_inputs(inputs: Vec<SegmentationTensorInput>) -> napi::Result<Vec<SegmentationInput>> {
    inputs
        .into_iter()
        .map(|input| {
            let data = match (input.f32_data, input.i32_data) {
                (Some(data), None) => SegmentationTensorData::F32(data.to_vec()),
                (None, Some(data)) => SegmentationTensorData::I32(data.to_vec()),
                _ => {
                    return Err(napi::Error::from_reason(
                        "segmentation input requires exactly one typed data array",
                    ));
                }
            };
            Ok(SegmentationInput {
                name: input.name,
                dimensions: input.dimensions,
                data,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropping_worker_releases_session_resources_before_returning() {
        let recorder = Recorder::new("session");
        let retained = Arc::downgrade(&recorder);
        let worker =
            SegmentationWorker::new(IDENTITY_ONNX.to_vec(), IDENTITY_ONNX.to_vec(), recorder)
                .unwrap();
        drop(worker);
        assert!(
            retained.upgrade().is_none(),
            "segmentation session resources outlived their owner"
        );
    }

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
            SegmentationCpuRuntime::from_bytes(&model, IDENTITY_ONNX, &Recorder::new("session"))
                .unwrap();
        let outputs = runtime
            .run_encoder_f32(
                vec![SegmentationInput {
                    name: "x".into(),
                    dimensions: vec![1, 1, 2, 2],
                    data: SegmentationTensorData::F32(vec![2.0, 4.0, 6.0, 8.0]),
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
        let mut runtime =
            SegmentationCpuRuntime::from_bytes(model, model, &Recorder::new("session"))
                .expect("valid test ONNX");
        assert_eq!(runtime.encoder_input_names(), ["x"]);
        assert_eq!(runtime.decoder_input_names(), ["x"]);
        let output = runtime
            .run_decoder_f32(
                vec![SegmentationInput {
                    name: "x".to_owned(),
                    dimensions: vec![1, 1, 2, 2],
                    data: SegmentationTensorData::F32(vec![1.0, 2.0, 3.0, 4.0]),
                }],
                &["y".into()],
            )
            .expect("decoder executes");
        assert_eq!(output[0].dimensions, [1, 1, 2, 2]);
        assert_eq!(output[0].data, [1.0, 2.0, 3.0, 4.0]);
        assert!(
            SegmentationCpuRuntime::from_bytes(b"not ONNX", model, &Recorder::new("session"))
                .is_err()
        );
    }
}
