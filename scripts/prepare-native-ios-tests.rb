require 'xcodeproj'

# The acceptance target is generated only in the disposable verification checkout.
project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
app = project.targets.find { |target| target.name == 'App' }
raise 'Native App target missing' unless app
tests = project.new_target(:ui_test_bundle, 'PartnerHubAcceptance', :ios, '15.0')
tests.add_dependency(app)
group = project.main_group.new_group('Acceptance', '../Acceptance')
tests.source_build_phase.add_file_reference(group.new_file('PartnerHubAcceptance.swift'))
tests.build_configurations.each do |configuration|
  configuration.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.vijaysoftwaresolutions.partnerhub.acceptance',
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'TEST_TARGET_NAME' => 'App',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.0',
    'CODE_SIGNING_ALLOWED' => 'NO',
    'TARGETED_DEVICE_FAMILY' => '1,2'
  })
end
project.root_object.attributes['TargetAttributes'][tests.uuid] = {
  'TestTargetID' => app.uuid
}
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_build_target(tests)
scheme.set_launch_target(app)
scheme.add_test_target(tests)
scheme.save_as(project.path, 'PartnerHubAcceptance', true)
project.save
