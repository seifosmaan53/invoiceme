/// `paymentSummary` of `GET /invoices/:id` (servers with payment state).
/// Amounts are decimal strings in [currency]. Absent on older servers.
class PaymentSummary {
  final String currency;
  final String grossPaid;
  final String refunded;
  final String disputed;
  final String net;

  /// none | paid | partially_refunded | refunded | disputed | dispute_lost
  final String state;
  final bool canReopen;

  const PaymentSummary({
    required this.currency,
    required this.grossPaid,
    required this.refunded,
    required this.disputed,
    required this.net,
    required this.state,
    required this.canReopen,
  });

  /// Null when [json] is not a payment summary (older server).
  static PaymentSummary? tryParse(Object? json) {
    if (json is! Map) return null;
    final state = json['state'];
    if (state is! String) return null;
    String amount(Object? v) => v == null ? '0' : v.toString();
    return PaymentSummary(
      currency: (json['currency'] as String?) ?? '',
      grossPaid: amount(json['grossPaid']),
      refunded: amount(json['refunded']),
      disputed: amount(json['disputed']),
      net: amount(json['net']),
      state: state,
      canReopen: json['canReopen'] == true,
    );
  }

  static bool _nonZero(String v) => (double.tryParse(v) ?? 0) != 0;

  bool get hasRefund => _nonZero(refunded);
  bool get hasDispute => _nonZero(disputed);

  /// Label of the payment-state chip, or null for `none`.
  String? get stateLabel {
    switch (state) {
      case 'none':
        return null;
      case 'paid':
        return 'Paid';
      case 'partially_refunded':
        return 'Partially refunded';
      case 'refunded':
        return 'Refunded';
      case 'disputed':
        return 'Disputed';
      case 'dispute_lost':
        return 'Dispute lost';
      default:
        return state;
    }
  }
}
