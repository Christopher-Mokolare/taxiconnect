// =============================================================================
// taxi.dart — Taxi model
// =============================================================================

enum TaxiStatus { available, boarding, departed, returning, breakdown }

enum DestinationCategory { market, hospital, busStation, school, church, other }

class Taxi {
  final String id;
  final String driverName;
  final String vehiclePlate;
  final String vehicleType;
  final String destination;
  final DestinationCategory destinationCategory;
  final String? destinationDetails;
  final TaxiStatus status;
  final int seatsAvailable;
  final int totalSeats;
  final int eta; // 0 = at stop, otherwise minutes
  final String conductorId;
  final String village;
  final int lastUpdated;
  final int? departureTime;
  final int viewerCount;

  const Taxi({
    required this.id,
    required this.driverName,
    required this.vehiclePlate,
    required this.vehicleType,
    required this.destination,
    required this.destinationCategory,
    this.destinationDetails,
    required this.status,
    required this.seatsAvailable,
    required this.totalSeats,
    required this.eta,
    required this.conductorId,
    required this.village,
    required this.lastUpdated,
    this.departureTime,
    this.viewerCount = 0,
  });

  factory Taxi.fromMap(String id, Map<dynamic, dynamic> map) {
    return Taxi(
      id: id,
      driverName: map['driverName'] ?? '',
      vehiclePlate: map['vehiclePlate'] ?? '',
      vehicleType: map['vehicleType'] ?? '14-Seater',
      destination: map['destination'] ?? '',
      destinationCategory: _parseCategory(map['destinationCategory']),
      destinationDetails: map['destinationDetails'],
      status: _parseStatus(map['status']),
      seatsAvailable: map['seatsAvailable'] ?? 0,
      totalSeats: map['totalSeats'] ?? 14,
      eta: map['eta'] ?? 0,
      conductorId: map['conductorId'] ?? '',
      village: map['village'] ?? '',
      lastUpdated: map['lastUpdated'] ?? 0,
      departureTime: map['departureTime'],
      viewerCount: map['passengerCount'] ?? 0,
    );
  }

  Map<String, dynamic> toMap() => {
        'driverName': driverName,
        'vehiclePlate': vehiclePlate,
        'vehicleType': vehicleType,
        'destination': destination,
        'destinationCategory': destinationCategory.name,
        'destinationDetails': destinationDetails,
        'status': status.name,
        'seatsAvailable': seatsAvailable,
        'totalSeats': totalSeats,
        'eta': eta,
        'conductorId': conductorId,
        'village': village,
        'lastUpdated': lastUpdated,
        'departureTime': departureTime,
        'passengerCount': viewerCount,
      };

  bool get isActive => status == TaxiStatus.available || status == TaxiStatus.boarding;

  static TaxiStatus _parseStatus(String? s) =>
      TaxiStatus.values.firstWhere((e) => e.name == s, orElse: () => TaxiStatus.available);

  static DestinationCategory _parseCategory(String? s) =>
      DestinationCategory.values.firstWhere((e) => e.name == s, orElse: () => DestinationCategory.other);
}

// =============================================================================
// waiting_passenger.dart — Passenger waiting signal model
// =============================================================================

enum WaitingStatus { waiting, assigned, pickedUp, cancelled }

class WaitingPassenger {
  final String id;
  final String passengerId;
  final String name;
  final String phone;
  final String village;
  final String destination;
  final DestinationCategory destinationCategory;
  final int groupSize;
  final int timestamp;
  final WaitingStatus status;
  final String conductorId;
  final String? assignedTaxiId;

  const WaitingPassenger({
    required this.id,
    required this.passengerId,
    required this.name,
    required this.phone,
    required this.village,
    required this.destination,
    required this.destinationCategory,
    required this.groupSize,
    required this.timestamp,
    required this.status,
    required this.conductorId,
    this.assignedTaxiId,
  });

  factory WaitingPassenger.fromMap(String id, Map<dynamic, dynamic> map) {
    return WaitingPassenger(
      id: id,
      passengerId: map['passengerId'] ?? '',
      name: map['name'] ?? 'Anonymous',
      phone: map['phone'] ?? '',
      village: map['village'] ?? '',
      destination: map['destination'] ?? '',
      destinationCategory: DestinationCategory.values.firstWhere(
        (e) => e.name == map['destinationCategory'],
        orElse: () => DestinationCategory.other,
      ),
      groupSize: map['groupSize'] ?? 1,
      timestamp: map['timestamp'] ?? 0,
      status: WaitingStatus.values.firstWhere(
        (e) => e.name == map['status'],
        orElse: () => WaitingStatus.waiting,
      ),
      conductorId: map['conductorId'] ?? '',
      assignedTaxiId: map['assignedTaxiId'],
    );
  }

  Map<String, dynamic> toMap() => {
        'passengerId': passengerId,
        'name': name,
        'phone': phone,
        'village': village,
        'destination': destination,
        'destinationCategory': destinationCategory.name,
        'groupSize': groupSize,
        'timestamp': timestamp,
        'status': status.name,
        'conductorId': conductorId,
        'assignedTaxiId': assignedTaxiId,
      };

  /// Minutes waiting since signal was sent
  int get minutesWaiting =>
      ((DateTime.now().millisecondsSinceEpoch - timestamp) / 60000).floor();
}

// =============================================================================
// destination_info.dart — Destination metadata and icon mapping
// =============================================================================

class DestinationInfo {
  final String label;
  final String emoji;
  final int colorValue; // dart:ui Color value

  const DestinationInfo({
    required this.label,
    required this.emoji,
    required this.colorValue,
  });

  static const Map<DestinationCategory, DestinationInfo> map = {
    DestinationCategory.market:     DestinationInfo(label: 'Market',      emoji: '🏪', colorValue: 0xFFFF9800),
    DestinationCategory.hospital:   DestinationInfo(label: 'Hospital',    emoji: '🏥', colorValue: 0xFFF44336),
    DestinationCategory.busStation: DestinationInfo(label: 'Bus Station', emoji: '🚌', colorValue: 0xFF2196F3),
    DestinationCategory.school:     DestinationInfo(label: 'School',      emoji: '📚', colorValue: 0xFF9C27B0),
    DestinationCategory.church:     DestinationInfo(label: 'Church',      emoji: '⛪', colorValue: 0xFFFFEB3B),
    DestinationCategory.other:      DestinationInfo(label: 'Other',       emoji: '📍', colorValue: 0xFF9E9E9E),
  };

  static DestinationInfo forCategory(DestinationCategory cat) =>
      map[cat] ?? map[DestinationCategory.other]!;
}
