Pod::Spec.new do |s|
  s.name           = 'ThirstrSafety'
  s.version        = '1.0.0'
  s.summary        = 'Date check-in Live Activity and app-icon quick actions for Thirstr.'
  s.description    = 'F-13 R-13.20 (#119): starts, updates and ends the check-in Live Activity; sets and reports home-screen quick actions.'
  s.author         = 'Thirstr'
  s.homepage       = 'https://thirstr.fun'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'UIKit'
  s.weak_frameworks = 'ActivityKit'
  s.source_files   = '**/*.{h,m,swift}'
end
