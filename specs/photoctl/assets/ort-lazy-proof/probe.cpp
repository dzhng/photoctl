#include <array>
#include <iostream>
#include <mutex>
#include <vector>
#include <onnxruntime_cxx_api.h>
#include <nlohmann/json.hpp>
#define CPUINFO_SUPPORTED
#include "core/common/cpuid_info.h"

using nlohmann::json;
std::mutex diagnostic_mutex;
std::vector<json> diagnostics;

void ORT_API_CALL capture(void*, OrtLoggingLevel severity, const char* category,
                          const char* id, const char* location, const char* message) {
  std::lock_guard<std::mutex> lock(diagnostic_mutex);
  diagnostics.push_back({{"severity", severity}, {"category", category},
                         {"id", id}, {"location", location}, {"message", message}});
}

int main() {
  std::cout << json({{"phase", "main_entered"}}).dump() << std::endl;
  Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "photoctl-proof", capture, nullptr);
  env.DisableTelemetryEvents();
  const auto& cpu = onnxruntime::CPUIDInfo::GetCPUIDInfo();
  json features = {{"vendor", cpu.GetCPUVendor()}, {"vendor_id", cpu.GetCPUVendorId()},
                   {"sme", cpu.HasArm_SME()}, {"sme2", cpu.HasArm_SME2()},
                   {"i8mm", cpu.HasArmNeon_I8MM()}, {"dot", cpu.HasArmNeonDot()}};
  const unsigned char model[] = {
    0x08,0x0a,0x12,0x0c,0x62,0x61,0x63,0x6b,0x65,0x6e,0x64,0x2d,0x74,0x65,0x73,0x74,
    0x3a,0x5b,0x0a,0x10,0x0a,0x01,0x78,0x12,0x01,0x79,0x22,0x08,0x49,0x64,0x65,0x6e,
    0x74,0x69,0x74,0x79,0x12,0x0d,0x74,0x65,0x73,0x74,0x5f,0x69,0x64,0x65,0x6e,0x74,
    0x69,0x74,0x79,0x5a,0x1b,0x0a,0x01,0x78,0x12,0x16,0x0a,0x14,0x08,0x01,0x12,0x10,
    0x0a,0x02,0x08,0x01,0x0a,0x02,0x08,0x01,0x0a,0x02,0x08,0x02,0x0a,0x02,0x08,0x02,
    0x62,0x1b,0x0a,0x01,0x79,0x12,0x16,0x0a,0x14,0x08,0x01,0x12,0x10,0x0a,0x02,0x08,
    0x01,0x0a,0x02,0x08,0x01,0x0a,0x02,0x08,0x02,0x0a,0x02,0x08,0x02,0x42,0x04,0x0a,
    0x00,0x10,0x15};
  Ort::SessionOptions options;
  options.SetIntraOpNumThreads(1);
  options.SetInterOpNumThreads(1);
  Ort::Session session(env, model, sizeof(model), options);
  std::array<float,4> values = {1,2,3,4};
  const std::array<int64_t,4> dimensions = {1,1,2,2};
  auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  auto tensor = Ort::Value::CreateTensor<float>(memory, values.data(), values.size(),
                                               dimensions.data(), dimensions.size());
  const char* inputs[] = {"x"};
  const char* outputs[] = {"y"};
  auto result = session.Run(Ort::RunOptions{nullptr}, inputs, &tensor, 1, outputs, 1);
  const float* data = result[0].GetTensorData<float>();
  std::vector<float> actual(data, data+4);
  bool rejected = false;
  try { Ort::Session invalid(env, "invalid", 7, options); }
  catch (const Ort::Exception&) { rejected = true; }
  std::cout << json({{"features", features}, {"output", actual},
                     {"invalid_model_rejected", rejected}, {"diagnostics", diagnostics}}).dump()
            << std::endl;
  return actual == std::vector<float>({1,2,3,4}) && rejected ? 0 : 1;
}
