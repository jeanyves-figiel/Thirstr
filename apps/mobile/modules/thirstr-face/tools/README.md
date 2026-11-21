# Face match model (F-18 R-18.15, #185)

`ios/ThirstrFaceNet.mlmodel` is **SFace** (MobileFaceNet trained with the SFace loss), from
[opencv_zoo `face_recognition_sface_2021dec.onnx`](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface),
licensed **Apache-2.0** (`LICENSE-SFace`). LFW accuracy 99.40 % (opencv_zoo eval).

- Input `face`: 112×112 RGB image, 0–255, aligned to the ArcFace 5-point template (normalisation is inside the model).
- Output `embedding`: 128 floats; compare with cosine similarity after L2 normalisation.
- Core ML neural network (runs on iOS 15.1+, ANE/GPU/CPU), weights 8-bit linear per layer: 9.8 MB.

## Rebuild

```sh
pip install onnx onnxruntime onnx2torch torch coremltools numpy
curl -LO https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
# sha256 0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79
python convert_sface.py face_recognition_sface_2021dec.onnx SFace.mlmodel
cp SFace-q8.mlmodel ../ios/ThirstrFaceNet.mlmodel
# sha256 of the shipped file: d014719217b897a176bd2d164922c01cf07cca6e54f56c1c540e182f6988c9af
```

Checks done at conversion (2026-11-21): ONNX → PyTorch max abs diff 3e-6; 8-bit weights vs fp32
embedding cosine ≥ 0.9995 on 13 real faces; Swift alignment (`FaceMatch.align`, Umeyama) reproduced in
Python gives pixel-identical crops to OpenCV `FaceRecognizerSF.alignCrop`. Same person ≥ 0.63,
different people ≤ 0.24 on that small set; OpenCV's LFW threshold is 0.363, the app uses 0.40.
