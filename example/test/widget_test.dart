import 'package:flutter_test/flutter_test.dart';

import 'package:example/main.dart';

void main() {
  testWidgets('ExampleApp loads and shows home', (WidgetTester tester) async {
    await tester.pumpWidget(const ExampleApp());

    expect(find.text('Saropa Drift Advisor Example'), findsWidgets);
  });
}
