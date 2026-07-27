import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'models/models.dart';

class FirebaseService {
  FirebaseService._();
  static final FirebaseService instance = FirebaseService._();

  final _db = FirebaseDatabase.instance.ref();
  final _auth = FirebaseAuth.instance;
  final _functions = FirebaseFunctions.instance;
  final _messaging = FirebaseMessaging.instance;

  // ---------------------------------------------------------------------------
  // AUTH
  // ---------------------------------------------------------------------------

  Future<void> signInAnonymous() => _auth.signInAnonymously();

  String? get currentUserId => _auth.currentUser?.uid;

  // ---------------------------------------------------------------------------
  // FCM TOKEN — save on login so Cloud Functions can reach this device
  // ---------------------------------------------------------------------------

  Future<void> saveToken() async {
    final token = await _messaging.getToken();
    if (token == null || currentUserId == null) return;
    await _db.child('passengers/$currentUserId/fcmToken').set(token);
  }

  // ---------------------------------------------------------------------------
  // TAXIS — real-time streams
  // ---------------------------------------------------------------------------

  /// All active taxis for a village (available + boarding)
  Stream<List<Taxi>> activeTaxisStream(String village) {
    return _db
        .child('taxis')
        .orderByChild('village')
        .equalTo(village)
        .onValue
        .map((event) {
      final data = event.snapshot.value as Map<dynamic, dynamic>? ?? {};
      return data.entries
          .map((e) => Taxi.fromMap(e.key as String, e.value as Map))
          .where((t) => t.isActive)
          .toList()
        ..sort((a, b) => a.eta.compareTo(b.eta));
    });
  }

  /// Active taxis filtered by destination
  Stream<List<Taxi>> taxisForDestinationStream(String village, String destination) {
    return activeTaxisStream(village).map(
      (taxis) => taxis.where((t) => t.destination == destination).toList(),
    );
  }

  // ---------------------------------------------------------------------------
  // TAXIS — writes (conductor / driver)
  // ---------------------------------------------------------------------------

  Future<String> addTaxi(Taxi taxi) async {
    final ref = _db.child('taxis').push();
    await ref.set(taxi.toMap());
    return ref.key!;
  }

  Future<void> updateTaxiStatus(String taxiId, TaxiStatus status, {int? departureTime}) async {
    final updates = <String, dynamic>{'status': status.name, 'lastUpdated': ServerValue.timestamp};
    if (departureTime != null) updates['departureTime'] = departureTime;
    await _db.child('taxis/$taxiId').update(updates);
  }

  Future<void> updateSeats(String taxiId, int seatsAvailable) =>
      _db.child('taxis/$taxiId').update({'seatsAvailable': seatsAvailable});

  Future<void> removeTaxi(String taxiId) => _db.child('taxis/$taxiId').remove();

  // ---------------------------------------------------------------------------
  // WAITING PASSENGERS — real-time streams
  // ---------------------------------------------------------------------------

  /// All waiting passengers for a village, grouped by destination
  Stream<Map<String, List<WaitingPassenger>>> waitingByDestinationStream(String village) {
    return _db
        .child('waitingPassengers')
        .orderByChild('village')
        .equalTo(village)
        .onValue
        .map((event) {
      final data = event.snapshot.value as Map<dynamic, dynamic>? ?? {};
      final grouped = <String, List<WaitingPassenger>>{};
      for (final e in data.entries) {
        final wp = WaitingPassenger.fromMap(e.key as String, e.value as Map);
        if (wp.status == WaitingStatus.waiting) {
          grouped.putIfAbsent(wp.destination, () => []).add(wp);
        }
      }
      return grouped;
    });
  }

  // ---------------------------------------------------------------------------
  // WAITING PASSENGERS — writes (passenger)
  // ---------------------------------------------------------------------------

  Future<String> sendWaitingSignal({
    required String name,
    required String phone,
    required String village,
    required String destination,
    required DestinationCategory destinationCategory,
    required int groupSize,
    required String conductorId,
  }) async {
    final ref = _db.child('waitingPassengers').push();
    await ref.set({
      'passengerId': currentUserId,
      'name': name,
      'phone': phone,
      'village': village,
      'destination': destination,
      'destinationCategory': destinationCategory.name,
      'groupSize': groupSize,
      'timestamp': ServerValue.timestamp,
      'status': 'waiting',
      'conductorId': conductorId,
      'assignedTaxiId': null,
    });
    return ref.key!;
  }

  Future<void> cancelWaitingSignal(String waitId) =>
      _db.child('waitingPassengers/$waitId').update({'status': 'cancelled'});

  // ---------------------------------------------------------------------------
  // ACTIVE VIEWERS — passenger watches a taxi
  // ---------------------------------------------------------------------------

  Future<void> watchTaxi(String taxiId) async {
    final uid = currentUserId;
    if (uid == null) return;
    await _db.child('activeViewers/$taxiId/$uid').set(true);
    await _db.child('activeViewers/$taxiId/count').transaction(
      (current) => (current as int? ?? 0) + 1,
    );
  }

  Future<void> unwatchTaxi(String taxiId) async {
    final uid = currentUserId;
    if (uid == null) return;
    await _db.child('activeViewers/$taxiId/$uid').remove();
    await _db.child('activeViewers/$taxiId/count').transaction(
      (current) => ((current as int? ?? 1) - 1).clamp(0, 9999),
    );
  }

  Stream<int> viewerCountStream(String taxiId) {
    return _db
        .child('activeViewers/$taxiId/count')
        .onValue
        .map((e) => (e.snapshot.value as int?) ?? 0);
  }

  // ---------------------------------------------------------------------------
  // SUMMON DRIVERS (conductor callable)
  // ---------------------------------------------------------------------------

  Future<String> summonDrivers({
    required String destination,
    required String village,
    required String conductorId,
    required int passengerCount,
  }) async {
    final result = await _functions.httpsCallable('summonDrivers').call({
      'destination': destination,
      'village': village,
      'conductorId': conductorId,
      'passengerCount': passengerCount,
    });
    return result.data['summonId'] as String;
  }

  // ---------------------------------------------------------------------------
  // DRIVER RESPONDS TO SUMMON
  // ---------------------------------------------------------------------------

  Future<void> respondToSummon({
    required String summonId,
    required bool accepted,
    required String driverName,
    required String driverPhone,
    required int eta,
  }) async {
    await _functions.httpsCallable('respondToSummon').call({
      'summonId': summonId,
      'accepted': accepted,
      'driverName': driverName,
      'driverPhone': driverPhone,
      'eta': eta,
    });
  }

  // ---------------------------------------------------------------------------
  // ANNOUNCEMENTS
  // ---------------------------------------------------------------------------

  Stream<List<Map<String, dynamic>>> announcementsStream(String village) {
    final now = DateTime.now().millisecondsSinceEpoch;
    return _db
        .child('announcements')
        .orderByChild('expires')
        .startAt(now)
        .onValue
        .map((event) {
      final data = event.snapshot.value as Map<dynamic, dynamic>? ?? {};
      return data.values
          .cast<Map>()
          .where((a) => a['village'] == village)
          .map((a) => Map<String, dynamic>.from(a))
          .toList();
    });
  }

  Future<void> postAnnouncement({
    required String conductorId,
    required String village,
    required String message,
    required Duration expiresIn,
  }) async {
    await _db.child('announcements').push().set({
      'conductorId': conductorId,
      'village': village,
      'message': message,
      'timestamp': ServerValue.timestamp,
      'expires': DateTime.now().add(expiresIn).millisecondsSinceEpoch,
    });
  }

  // ---------------------------------------------------------------------------
  // DEMAND HEATMAP (conductor analytics)
  // ---------------------------------------------------------------------------

  Stream<Map<String, int>> demandHeatmapStream(String village) {
    return _db.child('demandHeatmap/$village').onValue.map((event) {
      final data = event.snapshot.value as Map<dynamic, dynamic>? ?? {};
      return data.map((k, v) => MapEntry(k as String, (v['count'] as int?) ?? 0));
    });
  }

  // ---------------------------------------------------------------------------
  // PASSENGER PREFERENCES
  // ---------------------------------------------------------------------------

  Future<void> saveLastDestination(String destination) async {
    final uid = currentUserId;
    if (uid == null) return;
    await _db.child('passengerPreferences/$uid/lastDestination').set(destination);
    await _db
        .child('passengerPreferences/$uid/frequentDestinations/$destination')
        .transaction((current) => (current as int? ?? 0) + 1);
  }

  Future<String?> getLastDestination() async {
    final uid = currentUserId;
    if (uid == null) return null;
    final snap = await _db.child('passengerPreferences/$uid/lastDestination').get();
    return snap.value as String?;
  }

  // ---------------------------------------------------------------------------
  // SUBSCRIBE TO FCM TOPICS
  // ---------------------------------------------------------------------------

  Future<void> subscribeToVillage(String village) =>
      _messaging.subscribeToTopic('village_${village.replaceAll(' ', '_')}');

  Future<void> subscribeAsDriver(String village) =>
      _messaging.subscribeToTopic('drivers_${village.replaceAll(' ', '_')}');

  Future<void> subscribeToConductor(String conductorId) =>
      _messaging.subscribeToTopic('conductor_$conductorId');
}
