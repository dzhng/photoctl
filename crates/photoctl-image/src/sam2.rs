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
    sync::{Arc, Mutex},
};

/// CPU-only ONNX sessions compiled from hash-verified bytes owned by the
/// caller. The daemon keeps this object alive and separately caches the
/// prompt-independent encoder result.
pub struct Sam2CpuRuntime {
    encoder: Session,
    decoder: Session,
}

impl Sam2CpuRuntime {
    pub fn from_bytes(encoder: &[u8], decoder: &[u8]) -> Result<Self, String> {
        let encoder =
            cpu_session(encoder).map_err(|error| format!("invalid SAM encoder: {error}"))?;
        let decoder =
            cpu_session(decoder).map_err(|error| format!("invalid SAM decoder: {error}"))?;
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
        output: &str,
    ) -> Result<Sam2F32Output, String> {
        run_f32(&mut self.encoder, inputs, output)
    }

    pub fn run_decoder_f32(
        &mut self,
        inputs: Vec<Sam2Input>,
        output: &str,
    ) -> Result<Sam2F32Output, String> {
        run_f32(&mut self.decoder, inputs, output)
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
    output: &str,
) -> Result<Sam2F32Output, String> {
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
    let outputs = session.run(tensors).map_err(|error| error.to_string())?;
    if !outputs.contains_key(output) {
        return Err(format!("SAM model did not return {output}"));
    }
    let (dimensions, data) = outputs[output]
        .try_extract_tensor::<f32>()
        .map_err(|error| error.to_string())?;
    Ok(Sam2F32Output {
        dimensions: dimensions.iter().map(|value| *value as u32).collect(),
        data: data.to_vec(),
    })
}

fn cpu_session(bytes: &[u8]) -> ort::Result<Session> {
    Session::builder()?
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
        || logits.len() != (logit_width as usize) * (logit_height as usize)
    {
        return Err("invalid SAM logit dimensions".to_owned());
    }
    let mut mask = vec![0.0; mapping.base_width as usize * mapping.base_height as usize];
    for y in 0..mapping.base_height {
        for x in 0..mapping.base_width {
            let model_x = mapping.offset_x as f32
                + (x as f32 + 0.5) * mapping.resized_width as f32 / mapping.base_width as f32;
            let model_y = mapping.offset_y as f32
                + (y as f32 + 0.5) * mapping.resized_height as f32 / mapping.base_height as f32;
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
    inner: Arc<Mutex<Sam2CpuRuntime>>,
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

#[napi]
impl Sam2OnnxRuntime {
    #[napi(constructor)]
    pub fn new(encoder: Uint8Array, decoder: Uint8Array) -> napi::Result<Self> {
        Ok(Self {
            inner: Arc::new(Mutex::new(
                Sam2CpuRuntime::from_bytes(&encoder, &decoder).map_err(napi::Error::from_reason)?,
            )),
        })
    }

    #[napi]
    pub fn encoder_input_names(&self) -> Vec<String> {
        self.inner
            .lock()
            .expect("SAM runtime lock poisoned")
            .encoder_input_names()
            .into_iter()
            .map(str::to_owned)
            .collect()
    }

    #[napi]
    pub fn decoder_input_names(&self) -> Vec<String> {
        self.inner
            .lock()
            .expect("SAM runtime lock poisoned")
            .decoder_input_names()
            .into_iter()
            .map(str::to_owned)
            .collect()
    }

    #[napi]
    pub fn run_encoder(
        &self,
        inputs: Vec<Sam2TensorInput>,
        output: String,
    ) -> napi::Result<AsyncTask<Sam2RunTask>> {
        Ok(AsyncTask::new(Sam2RunTask {
            runtime: Arc::clone(&self.inner),
            inputs: to_native_inputs(inputs)?,
            output,
            decoder: false,
        }))
    }

    #[napi]
    pub fn run_decoder(
        &self,
        inputs: Vec<Sam2TensorInput>,
        output: String,
    ) -> napi::Result<AsyncTask<Sam2RunTask>> {
        Ok(AsyncTask::new(Sam2RunTask {
            runtime: Arc::clone(&self.inner),
            inputs: to_native_inputs(inputs)?,
            output,
            decoder: true,
        }))
    }
}

pub struct Sam2RunTask {
    runtime: Arc<Mutex<Sam2CpuRuntime>>,
    inputs: Vec<Sam2Input>,
    output: String,
    decoder: bool,
}

impl Task for Sam2RunTask {
    type Output = Sam2F32Output;
    type JsValue = Sam2TensorOutput;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| napi::Error::from_reason("SAM runtime lock poisoned"))?;
        let inputs = std::mem::take(&mut self.inputs);
        if self.decoder {
            runtime.run_decoder_f32(inputs, &self.output)
        } else {
            runtime.run_encoder_f32(inputs, &self.output)
        }
        .map_err(napi::Error::from_reason)
    }

    fn resolve(&mut self, _env: napi::Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(Sam2TensorOutput {
            dimensions: output.dimensions,
            data: output.data.into(),
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
) -> napi::Result<Float32Array> {
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
        },
    )
    .map(Into::into)
    .map_err(napi::Error::from_reason)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constructs_cpu_sessions_from_caller_supplied_onnx_bytes() {
        let model = include_bytes!("../tests/data/identity-opset17.onnx");
        let mut runtime = Sam2CpuRuntime::from_bytes(model, model).expect("valid test ONNX");
        assert_eq!(runtime.encoder_input_names(), ["x"]);
        assert_eq!(runtime.decoder_input_names(), ["x"]);
        let output = runtime
            .run_decoder_f32(
                vec![Sam2Input {
                    name: "x".to_owned(),
                    dimensions: vec![1, 1, 2, 2],
                    data: Sam2TensorData::F32(vec![1.0, 2.0, 3.0, 4.0]),
                }],
                "y",
            )
            .expect("decoder executes");
        assert_eq!(output.dimensions, [1, 1, 2, 2]);
        assert_eq!(output.data, [1.0, 2.0, 3.0, 4.0]);
        assert!(Sam2CpuRuntime::from_bytes(b"not ONNX", model).is_err());
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
        };
        assert_eq!(
            mask_from_sam2_logits(&[-1.0, 1.0, -0.25, 0.25], 2, 2, mapping).unwrap(),
            [0.0, 1.0, 0.0, 1.0]
        );
    }
}
