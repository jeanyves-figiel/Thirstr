Pod::Spec.new do |s|
  s.name           = 'ThirstrTranslate'
  s.version        = '1.0.0'
  s.summary        = 'On-device chat translation for Thirstr (Apple Translation + NaturalLanguage).'
  s.description    = 'F-07 R-07.25: detects and translates chat text on the phone. No text leaves the device.'
  s.author         = 'Thirstr'
  s.homepage       = 'https://thirstr.fun'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'NaturalLanguage', 'SwiftUI'
  s.weak_frameworks = 'Translation'
  s.source_files   = '**/*.{h,m,swift}'
end
