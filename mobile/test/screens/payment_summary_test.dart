// Flutter imports
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

// Local imports
import 'package:invoiceme/core/providers/providers.dart';
import 'package:invoiceme/core/services/api_client.dart';
import 'package:invoiceme/models/invoice.dart';
import 'package:invoiceme/models/payment_summary.dart';
import 'package:invoiceme/screens/invoice_detail_screen.dart';
import 'package:invoiceme/widgets/payment_summary_card.dart';

Map<String, dynamic> summary(String state, {String gross = '100.00', String refunded = '0.00', String disputed = '0.00', String net = '100.00', bool canReopen = false}) => {
      'currency': 'USD',
      'grossPaid': gross,
      'refunded': refunded,
      'disputed': disputed,
      'net': net,
      'state': state,
      'canReopen': canReopen,
    };

Future<void> pumpCard(WidgetTester tester, Map<String, dynamic>? json, {VoidCallback? onReopen}) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(body: PaymentSummaryCard(summary: PaymentSummary.tryParse(json), onReopen: onReopen)),
  ));
}

Map<String, dynamic> invoiceJson({Map<String, dynamic>? paymentSummary}) => {
      'id': 'inv-1',
      'userId': 'u1',
      'clientId': 'c1',
      'type': 'invoice',
      'number': 'INV-0001',
      'status': 'paid',
      'issueDate': '2026-10-01',
      'currency': 'USD',
      'subtotal': '100.00',
      'taxTotal': '0.00',
      'discountTotal': '0.00',
      'total': '100.00',
      'createdAt': '2026-10-01T00:00:00.000Z',
      'updatedAt': '2026-10-01T00:00:00.000Z',
      'items': [],
      if (paymentSummary != null) 'paymentSummary': paymentSummary,
    };

class FakeApiClient extends ApiClient {
  final Map<String, dynamic> invoice;
  final posts = <String>[];

  FakeApiClient(this.invoice);

  @override
  Future<Response> get(String path, {Map<String, dynamic>? queryParameters, bool useCache = true}) async {
    final data = path.endsWith('/attachments') ? <dynamic>[] : invoice;
    return Response(requestOptions: RequestOptions(path: path), data: data, statusCode: 200);
  }

  @override
  Future<Response> post(String path, {dynamic data}) async {
    posts.add(path);
    return Response(requestOptions: RequestOptions(path: path), data: {}, statusCode: 200);
  }
}

Future<FakeApiClient> pumpScreen(WidgetTester tester, Map<String, dynamic> json) async {
  final api = FakeApiClient(json);
  tester.view.physicalSize = const Size(1200, 4000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(api)],
    child: MaterialApp(home: InvoiceDetailScreen(invoice: Invoice.fromJson(json))),
  ));
  await tester.pumpAndSettle();
  return api;
}

void main() {
  testWidgets('partial refund: chip plus gross, refunded and net as separate amounts', (tester) async {
    await pumpCard(tester, summary('partially_refunded', refunded: '30.00', net: '70.00'));
    expect(find.text('Partially refunded'), findsOneWidget);
    expect(find.text('Paid (gross)'), findsOneWidget);
    expect(find.text('Refunded'), findsOneWidget);
    expect(find.text('Net received'), findsOneWidget);
    expect(find.text('\$100.00'), findsOneWidget);
    expect(find.text('\$30.00'), findsOneWidget);
    expect(find.text('\$70.00'), findsOneWidget);
    expect(find.textContaining('Total'), findsNothing);
    expect(find.textContaining('due', findRichText: true), findsNothing);
  });

  testWidgets('full refund: shows Refunded, net 0, nothing owed', (tester) async {
    await pumpCard(tester, summary('refunded', refunded: '100.00', net: '0.00'));
    expect(find.byKey(const ValueKey('payment-state-chip')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const ValueKey('payment-state-chip')), matching: find.text('Refunded')),
        findsOneWidget);
    expect(find.text('\$0.00'), findsOneWidget);
    expect(find.textContaining('Owe'), findsNothing);
    expect(find.textContaining('Due'), findsNothing);
    expect(find.byKey(const ValueKey('reopen-invoice')), findsNothing);
  });

  testWidgets('dispute: shows Disputed amount, no refund row', (tester) async {
    await pumpCard(tester, summary('disputed', disputed: '100.00', net: '0.00'));
    expect(find.text('Disputed'), findsNWidgets(2)); // chip and amount label
    expect(find.byKey(const ValueKey('amount-disputed')), findsOneWidget);
    expect(find.byKey(const ValueKey('amount-refunded')), findsNothing);
  });

  testWidgets('dispute lost chip', (tester) async {
    await pumpCard(tester, summary('dispute_lost', disputed: '100.00', net: '0.00'));
    expect(find.text('Dispute lost'), findsOneWidget);
  });

  testWidgets('paid without refunds: chip only, no breakdown', (tester) async {
    await pumpCard(tester, summary('paid'));
    expect(find.text('Paid'), findsOneWidget);
    expect(find.byKey(const ValueKey('amount-net')), findsNothing);
  });

  testWidgets('reopen is offered only when canReopen', (tester) async {
    var tapped = 0;
    await pumpCard(tester, summary('paid', canReopen: true), onReopen: () => tapped++);
    await tester.tap(find.byKey(const ValueKey('reopen-invoice')));
    expect(tapped, 1);
    await pumpCard(tester, summary('paid'), onReopen: () => tapped++);
    expect(find.byKey(const ValueKey('reopen-invoice')), findsNothing);
  });

  testWidgets('no paymentSummary (older server) renders nothing', (tester) async {
    await pumpCard(tester, null);
    expect(find.byKey(const ValueKey('payment-summary')), findsNothing);
    expect(PaymentSummary.tryParse({'currency': 'USD'}), isNull);
  });

  testWidgets('invoice detail from an older server (no paymentSummary) shows no payment card', (tester) async {
    await pumpScreen(tester, invoiceJson());
    expect(find.text('INV-0001'), findsWidgets);
    expect(find.byKey(const ValueKey('payment-summary')), findsNothing);
  });

  testWidgets('invoice detail shows the payment card and reopens after confirmation', (tester) async {
    final api = await pumpScreen(
      tester,
      invoiceJson(paymentSummary: summary('partially_refunded', refunded: '30.00', net: '70.00', canReopen: true)),
    );
    expect(find.byKey(const ValueKey('payment-summary')), findsOneWidget);
    expect(find.text('PAID'), findsWidgets); // invoice status unchanged
    await tester.tap(find.byKey(const ValueKey('reopen-invoice')));
    await tester.pumpAndSettle();
    expect(find.text('Reopen invoice?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(api.posts, isEmpty);
    await tester.tap(find.byKey(const ValueKey('reopen-invoice')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Reopen'));
    await tester.pumpAndSettle();
    expect(api.posts, ['/invoices/inv-1/reopen']);
  });
}
