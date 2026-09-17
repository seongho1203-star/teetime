require 'xcodeproj'
project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
app = project.targets.find { |t| t.name == 'App' }
tests = project.new_target(:unit_test_bundle, 'NativeChatTests', :ios, '15.0')
tests.add_dependency(app)
file = project.main_group.new_file('../../.dev/NativeChatTests.swift')
tests.source_build_phase.add_file_reference(file)
tests.build_configurations.each do |c|
  c.base_configuration_reference = app.build_configurations.find { |a| a.name == c.name }.base_configuration_reference
  c.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.kkakkung.app.NativeChatTests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.0',
    'TEST_HOST' => '$(BUILT_PRODUCTS_DIR)/App.app/App',
    'BUNDLE_LOADER' => '$(TEST_HOST)',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'CODE_SIGNING_ALLOWED' => 'NO'
  })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(tests)
scheme.set_launch_target(app)
scheme.save_as('ios/App/App.xcodeproj', 'NativeChatTests', true)
