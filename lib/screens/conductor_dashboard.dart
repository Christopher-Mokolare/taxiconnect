import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/firebase_service.dart';
import '../widgets/taxi_card.dart';
import '../widgets/add_taxi_sheet.dart';
import '../widgets/announcement_sheet.dart';

class ConductorDashboardScreen extends StatefulWidget {
  final String conductorId;
  final String conductorName;
  final String village;

  const ConductorDashboardScreen({
    super.key,
    required this.conductorId,
    required this.conductorName,
    required this.village,
  });

  @override
  State<ConductorDashboardScreen> createState() => _ConductorDashboardScreenState();
}

class _ConductorDashboardScreenState extends State<ConductorDashboardScreen> {
  final _svc = FirebaseService.instance;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF0F0F0),
      appBar: AppBar(
        title: Text('☀️ ${widget.village} — Conductor'),
        backgroundColor: Colors.black87,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.campaign),
            tooltip: 'Post Announcement',
            onPressed: () => _showAnnouncementSheet(),
          ),
          IconButton(
            icon: const Icon(Icons.add_circle_outline),
            tooltip: 'Add Taxi',
            onPressed: () => _showAddTaxiSheet(),
          ),
        ],
      ),
      body: StreamBuilder<List<Taxi>>(
        stream: _svc.activeTaxisStream(widget.village),
        builder: (context, taxiSnap) {
          return StreamBuilder<Map<String, List<WaitingPassenger>>>(
            stream: _svc.waitingByDestinationStream(widget.village),
            builder: (context, waitSnap) {
              final taxis = taxiSnap.data ?? [];
              final waitingByDest = waitSnap.data ?? {};

              // All unique destinations across taxis and waiting passengers
              final allDestinations = {
                ...taxis.map((t) => t.destination),
                ...waitingByDest.keys,
              }.toList()..sort();

              return ListView(
                padding: const EdgeInsets.all(12),
                children: [
                  // Overview summary row
                  _DemandOverviewCard(
                    taxis: taxis,
                    waitingByDest: waitingByDest,
                    allDestinations: allDestinations,
                  ),
                  const SizedBox(height(12)),

                  // One section per destination
                  ...allDestinations.map((dest) {
                    final destTaxis = taxis.where((t) => t.destination == dest).toList();
                    final destWaiting = waitingByDest[dest] ?? [];
                    return _DestinationSection(
                      destination: dest,
                      taxis: destTaxis,
                      waitingPassengers: destWaiting,
                      conductorId: widget.conductorId,
                      village: widget.village,
                      onSummon: () => _summonDrivers(dest, destWaiting.length),
                      onTaxiStatusChange: _updateTaxiStatus,
                    );
                  }),
                ],
              );
            },
          );
        },
      ),
    );
  }

  Future<void> _summonDrivers(String destination, int passengerCount) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Summon Drivers'),
        content: Text(
          'Send a push notification to all drivers near ${widget.village} for $destination?\n\n'
          '$passengerCount passenger(s) are waiting.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('📢 Summon', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      await _svc.summonDrivers(
        destination: destination,
        village: widget.village,
        conductorId: widget.conductorId,
        passengerCount: passengerCount,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('✅ Drivers summoned for $destination!')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _updateTaxiStatus(String taxiId, TaxiStatus status) async {
    await _svc.updateTaxiStatus(taxiId, status,
        departureTime: status == TaxiStatus.departed
            ? DateTime.now().millisecondsSinceEpoch
            : null);
    if (status == TaxiStatus.departed) {
      await _svc.removeTaxi(taxiId);
    }
  }

  void _showAddTaxiSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => AddTaxiSheet(
        conductorId: widget.conductorId,
        village: widget.village,
      ),
    );
  }

  void _showAnnouncementSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => AnnouncementSheet(
        conductorId: widget.conductorId,
        village: widget.village,
      ),
    );
  }
}

// =============================================================================
// DEMAND OVERVIEW CARD
// =============================================================================

class _DemandOverviewCard extends StatelessWidget {
  final List<Taxi> taxis;
  final Map<String, List<WaitingPassenger>> waitingByDest;
  final List<String> allDestinations;

  const _DemandOverviewCard({
    required this.taxis,
    required this.waitingByDest,
    required this.allDestinations,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('📊 Demand Overview',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 8),
            ...allDestinations.map((dest) {
              final taxiCount = taxis.where((t) => t.destination == dest).length;
              final waitCount = waitingByDest[dest]?.length ?? 0;
              final hasAlert = waitCount > 0 && taxiCount == 0;
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  children: [
                    if (hasAlert)
                      const Icon(Icons.warning_amber, color: Colors.red, size: 16)
                    else
                      const Icon(Icons.circle, color: Colors.green, size: 10),
                    const SizedBox(width: 8),
                    Expanded(child: Text(dest, style: const TextStyle(fontWeight: FontWeight.w500))),
                    Text('$taxiCount taxi${taxiCount != 1 ? 's' : ''}',
                        style: TextStyle(color: taxiCount > 0 ? Colors.green : Colors.grey)),
                    const SizedBox(width: 12),
                    Text('$waitCount waiting',
                        style: TextStyle(
                            color: waitCount > 0 ? Colors.orange : Colors.grey,
                            fontWeight: waitCount > 0 ? FontWeight.bold : FontWeight.normal)),
                  ],
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// DESTINATION SECTION
// =============================================================================

class _DestinationSection extends StatelessWidget {
  final String destination;
  final List<Taxi> taxis;
  final List<WaitingPassenger> waitingPassengers;
  final String conductorId;
  final String village;
  final VoidCallback onSummon;
  final Future<void> Function(String taxiId, TaxiStatus status) onTaxiStatusChange;

  const _DestinationSection({
    required this.destination,
    required this.taxis,
    required this.waitingPassengers,
    required this.conductorId,
    required this.village,
    required this.onSummon,
    required this.onTaxiStatusChange,
  });

  @override
  Widget build(BuildContext context) {
    final hasAlert = waitingPassengers.isNotEmpty && taxis.isEmpty;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: hasAlert ? Colors.red.shade300 : Colors.transparent,
          width: hasAlert ? 2 : 0,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Section header
            Row(
              children: [
                Text(
                  '📍 $destination',
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
                const Spacer(),
                if (waitingPassengers.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: Colors.red,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      '${waitingPassengers.length} waiting',
                      style: const TextStyle(color: Colors.white, fontSize: 12),
                    ),
                  ),
              ],
            ),
            const Divider(),

            // Taxis for this destination
            if (taxis.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 4),
                child: Text('No taxis assigned', style: TextStyle(color: Colors.grey)),
              )
            else
              ...taxis.map((t) => _ConductorTaxiRow(
                    taxi: t,
                    onStatusChange: (status) => onTaxiStatusChange(t.id, status),
                  )),

            // Waiting passengers list
            if (waitingPassengers.isNotEmpty) ...[
              const SizedBox(height: 8),
              const Text('👥 Waiting Passengers',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
              const SizedBox(height: 4),
              ...waitingPassengers.map((p) => _WaitingPassengerRow(passenger: p)),
            ],

            // Summon button when no taxis but passengers waiting
            if (hasAlert) ...[
              const SizedBox(height: 8),
              ElevatedButton.icon(
                onPressed: onSummon,
                icon: const Icon(Icons.campaign),
                label: Text('📢 Summon Drivers for $destination'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.red,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 44),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// CONDUCTOR TAXI ROW — action buttons per taxi
// =============================================================================

class _ConductorTaxiRow extends StatelessWidget {
  final Taxi taxi;
  final ValueChanged<TaxiStatus> onStatusChange;

  const _ConductorTaxiRow({required this.taxi, required this.onStatusChange});

  @override
  Widget build(BuildContext context) {
    final statusColor = taxi.status == TaxiStatus.boarding
        ? Colors.orange
        : taxi.status == TaxiStatus.available
            ? Colors.green
            : Colors.grey;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.grey.shade50,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: statusColor.withOpacity(0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(width: 10, height: 10, decoration: BoxDecoration(color: statusColor, shape: BoxShape.circle)),
              const SizedBox(width: 8),
              Text(taxi.driverName, style: const TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(width: 8),
              Text(taxi.vehiclePlate, style: const TextStyle(color: Colors.grey, fontSize: 12)),
              const Spacer(),
              Text('🪑 ${taxi.seatsAvailable}/${taxi.totalSeats}',
                  style: const TextStyle(fontSize: 13)),
            ],
          ),
          if (taxi.eta > 0)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('⏱️ ETA: ${taxi.eta} mins', style: const TextStyle(color: Colors.blue, fontSize: 12)),
            ),
          const SizedBox(height: 8),
          Row(
            children: [
              _ActionButton(
                label: '🚗 Depart',
                color: Colors.blue,
                onTap: () => onStatusChange(TaxiStatus.departed),
              ),
              const SizedBox(width: 8),
              _ActionButton(
                label: '✅ Full',
                color: Colors.green,
                onTap: () => onStatusChange(TaxiStatus.boarding),
              ),
              const SizedBox(width: 8),
              _ActionButton(
                label: '⚠️ Breakdown',
                color: Colors.red,
                onTap: () => onStatusChange(TaxiStatus.breakdown),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _ActionButton({required this.label, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: OutlinedButton(
        onPressed: onTap,
        style: OutlinedButton.styleFrom(
          foregroundColor: color,
          side: BorderSide(color: color),
          padding: const EdgeInsets.symmetric(vertical: 6),
          textStyle: const TextStyle(fontSize: 11),
        ),
        child: Text(label),
      ),
    );
  }
}

// =============================================================================
// WAITING PASSENGER ROW
// =============================================================================

class _WaitingPassengerRow extends StatelessWidget {
  final WaitingPassenger passenger;

  const _WaitingPassengerRow({required this.passenger});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          const Icon(Icons.person_outline, size: 16, color: Colors.grey),
          const SizedBox(width: 6),
          Expanded(child: Text(passenger.name, style: const TextStyle(fontSize: 13))),
          Text('👥 ${passenger.groupSize}', style: const TextStyle(fontSize: 12)),
          const SizedBox(width: 8),
          Text('🕐 ${passenger.minutesWaiting}m',
              style: TextStyle(
                fontSize: 12,
                color: passenger.minutesWaiting > 20 ? Colors.red : Colors.grey,
              )),
        ],
      ),
    );
  }
}
