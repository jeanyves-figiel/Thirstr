Pod::Spec.new do |s|
  s.name           = 'ThirstrAsk'
  s.version        = '1.0.0'
  s.summary        = 'On-device Ask for Thirstr (Apple Foundation Models + on-device speech).'
  s.description    = 'F-24 R-24.1, R-24.3 (#346): parses a search on the phone and dictates on the phone. Nothing leaves the device.'
  s.author         = 'Thirstr'
  s.homepage       = 'https://thirstr.fun'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'Speech', 'AVFoundation'
  s.weak_frameworks = 'FoundationModels'
  s.source_files   = '**/*.{h,m,swift}'
end
