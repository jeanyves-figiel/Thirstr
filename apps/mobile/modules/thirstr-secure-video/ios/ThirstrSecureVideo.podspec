Pod::Spec.new do |s|
  s.name           = 'ThirstrSecureVideo'
  s.version        = '1.0.0'
  s.summary        = 'Capture-protected one-time video playback for the Thirstr video check.'
  s.description    = 'F-18 R-18.11/R-18.13: plays a local clip inside a capture-protected layer, blacks out while the screen is captured, reports screenshots, strips clip metadata.'
  s.author         = 'Thirstr'
  s.homepage       = 'https://thirstr.fun'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'AVFoundation'
  s.source_files   = '**/*.{h,m,swift}'
end
