#ifndef IE_NODE_NETWORK_H
#define IE_NODE_NETWORK_H

#include <napi.h>

#include "inference_engine.hpp"

namespace ienodejs {

class Network : public Napi::ObjectWrap<Network> {
 public:
  static void Init(const Napi::Env& env);
  static void NewInstanceAsync(Napi::Env env, const Napi::Value& model, const Napi::Value& weights, Napi::Promise::Deferred& deferred);
  Network(const Napi::CallbackInfo& info);

 private:
  friend class NetworkAsyncWorker;

  static Napi::FunctionReference constructor;
  // APIs
  Napi::Value getName(const Napi::CallbackInfo& info);

  std::string model_;
  std::string weights_;
  InferenceEngine::CNNNetwork actual_;
};

}  // namespace ienodejs

#endif  // IE_NODE_NETWORK_H