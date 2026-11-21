import sys, numpy as np, onnx, torch, onnxruntime as ort, coremltools as ct
from onnx2torch import convert
src, out = sys.argv[1], sys.argv[2]
m = onnx.load(src)
for n in m.graph.node[:3]: print(n.op_type, n.input, [onnx.numpy_helper.to_array(t).ravel()[:3] for t in m.graph.initializer if t.name in n.input])
net = convert(m).eval()
x = np.random.RandomState(0).uniform(0,255,(4,3,112,112)).astype(np.float32)
sess = ort.InferenceSession(src)
ref = np.concatenate([sess.run(None,{'data':x[i:i+1]})[0] for i in range(4)])
with torch.no_grad(): got = np.concatenate([net(torch.from_numpy(x[i:i+1])).numpy() for i in range(4)])
print('torch vs onnx max abs', np.abs(ref-got).max())
tr = torch.jit.trace(net, torch.from_numpy(x[:1]))
ml = ct.convert(tr, inputs=[ct.ImageType(name='face', shape=(1,3,112,112), color_layout=ct.colorlayout.RGB, scale=1.0)],
  outputs=[ct.TensorType(name='embedding')], convert_to='neuralnetwork', minimum_deployment_target=ct.target.iOS14)
ml.short_description='SFace (MobileFaceNet) 128-d face embedding. Input: 112x112 RGB face aligned to the ArcFace 5-point template.'
ml.license='Apache-2.0 (opencv_zoo face_recognition_sface_2021dec)'
ml.save(out)
print('saved')
from coremltools.models.neural_network import quantization_utils as q
for bits,name in [(16,'fp16'),(8,'q8')]:
    qm = q.quantize_weights(ml, nbits=bits) if bits==16 else q.quantize_weights(ml, nbits=8, quantization_mode='linear')
    qm.save(out.replace('.mlmodel', f'-{name}.mlmodel'))
print('quantized')
