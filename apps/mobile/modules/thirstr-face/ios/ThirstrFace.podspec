Pod::Spec.new do |s|
  s.name           = 'ThirstrFace'
  s.version        = '1.0.0'
  s.summary        = 'On-device face landmarks (liveness) and face match (video check) for Thirstr.'
  s.description    = 'F-03 liveness: yaw, pitch, eye openness and mouth width from Apple Vision. Video check face match (R-18.15): SFace embeddings in Core ML. Images never leave the device.'
  s.author         = 'Thirstr'
  s.homepage       = 'https://thirstr.fun'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'Vision', 'CoreML', 'AVFoundation'
  # SFace / MobileFaceNet, Apache-2.0 (opencv_zoo), 8-bit weights. See tools/README.md.
  s.resources      = 'ThirstrFaceNet.mlmodel'
  s.source_files   = '**/*.{h,m,swift}'
end
