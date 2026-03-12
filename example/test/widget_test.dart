import 'package:flutter_test/flutter_test.dart';

import 'package:example/main.dart';

void main() {
  testWidgets('ExampleApp loads and shows home', (WidgetTester tester) async {
    await tester.pumpWidget(const ExampleApp());

    expect(find.text('Saropa Drift Advisor Example'), findsWidgets);

    // Advance time past the 30-second initialization timeout to settle the timer.
    await tester.pump(const Duration(seconds: 31));
  });
}
