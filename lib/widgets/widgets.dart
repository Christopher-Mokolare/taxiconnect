import 'package:flutter/material.dart';
import 'package:firebase_database/firebase_database.dart';
import '../models/models.dart';
import '../services/firebase_service.dart';

// =============================================================================
// TaxiCard — used in both passenger and conductor views
// =============================================================================

class TaxiCard extends StatelessWidget {
  final Taxi taxi;
  final bool showWatchButton;
  final VoidCallback? onSwitchDestination;

  const TaxiCard({
    super.key,
    required this.taxi,
    this.showWatchButton = true,
    this.onSwitchDestination,
  });

  @override
  Widget build(BuildContext context) {
    final info = DestinationInfo.forCategory(taxi.destinationCategory);
    final statusColor = taxi.status == TaxiStatus.boarding
        ? Colors.orange
        : taxi.status == TaxiStatus.available
            ? Colors.green
            : Colors.grey;
    final statusLabel = taxi.status == TaxiStatus.boarding
        ? 'BOARDING NOW'
        : taxi.status == TaxiStatus.available
            ? 'ARRIVING IN ${taxi.eta} MINS'
            : taxi.status.name.toUpperCase();

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: statusColor.withOpacity(0.5), width: 1.5),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(info.emoji, style: const TextStyle(fontSize: 22)),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(taxi.driverName,
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                      Text(
                        '📍 ${taxi.destination}${taxi.destinationDetails != null ? ' · ${taxi.destinationDetails}' : ''}',
                        style: const TextStyle(color: Colors.black87, fontSize: 13),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: statusColor),
                  ),
                  child: Text(statusLabel,
                      style: TextStyle(
                          color: statusColor, fontSize: 11, fontWeight: FontWeight.bold)),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.event_seat, size: 16, color: Colors.grey),
                const SizedBox(width: 4),
                Text('${taxi.seatsAvailable} seats left · ${taxi.vehicleType}',
                    style: const TextStyle(fontSize: 13, color: Colors.black54)),
                const Spacer(),
                StreamBuilder<int>(
                  stream: FirebaseService.instance.viewerCountStream(taxi.id),
                  builder: (_, snap) {
                    final count = snap.data ?? taxi.viewerCount;
                    return Text('👁️ $count watching',
                        style: const TextStyle(fontSize: 12, color: Colors.grey));
                  },
                ),
              ],
            ),
            if (showWatchButton) ...[
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => FirebaseService.instance.watchTaxi(taxi.id),
                  icon: const Icon(Icons.visibility_outlined, size: 16),
                  label: const Text("👀 I'M WATCHING"),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.black87,
                    side: const BorderSide(color: Colors.black26),
                  ),
                ),
              ),
            ],
            if (onSwitchDestination != null) ...[
              const SizedBox(height: 8),
              TextButton(
                onPressed: onSwitchDestination,
                child: Text('🔀 Switch to ${taxi.destination} view',
                    style: const TextStyle(fontSize: 12)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// WaitingSheet — bottom sheet for passenger "I'm Waiting" signal
// =============================================================================

class WaitingSheet extends StatefulWidget {
  final String preselectedDestination;
  final List<String> destinations;
  final String village;
  final String conductorId;
  final ValueChanged<String> onSignalSent;

  const WaitingSheet({
    super.key,
    required this.preselectedDestination,
    required this.destinations,
    required this.village,
    required this.conductorId,
    required this.onSignalSent,
  });

  @override
  State<WaitingSheet> createState() => _WaitingSheetState();
}

class _WaitingSheetState extends State<WaitingSheet> {
  final _svc = FirebaseService.instance;
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();

  late String _destination;
  int _groupSize = 1;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _destination = widget.preselectedDestination;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Center(
            child: Text('📢 Signal You\'re Waiting',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
          ),
          const SizedBox(height: 16),

          // Destination
          DropdownButtonFormField<String>(
            value: _destination,
            decoration: const InputDecoration(
              labelText: 'Where are you going?',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.location_on),
            ),
            items: widget.destinations
                .map((d) => DropdownMenuItem(value: d, child: Text(d)))
                .toList(),
            onChanged: (v) { if (v != null) setState(() => _destination = v); },
          ),
          const SizedBox(height: 12),

          // Name
          TextField(
            controller: _nameController,
            decoration: const InputDecoration(
              labelText: 'Your name',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.person_outline),
            ),
          ),
          const SizedBox(height: 12),

          // Group size
          Row(
            children: [
              const Text('How many people?', style: TextStyle(fontWeight: FontWeight.w500)),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.remove_circle_outline),
                onPressed: _groupSize > 1 ? () => setState(() => _groupSize--) : null,
              ),
              Text('$_groupSize', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              IconButton(
                icon: const Icon(Icons.add_circle_outline),
                onPressed: _groupSize < 10 ? () => setState(() => _groupSize++) : null,
              ),
            ],
          ),
          const SizedBox(height: 16),

          ElevatedButton.icon(
            onPressed: _loading ? null : _sendSignal,
            icon: _loading
                ? const SizedBox(
                    width: 18, height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.campaign),
            label: const Text('✅ SEND WAITING SIGNAL',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.red,
              foregroundColor: Colors.white,
              minimumSize: const Size(double.infinity, 52),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _sendSignal() async {
    setState(() => _loading = true);
    try {
      final category = DestinationCategory.values.firstWhere(
        (c) => DestinationInfo.forCategory(c).label.toLowerCase() ==
            _destination.toLowerCase().replaceAll(' ', ''),
        orElse: () => DestinationCategory.other,
      );

      final waitId = await _svc.sendWaitingSignal(
        name: _nameController.text.trim().isEmpty ? 'Anonymous' : _nameController.text.trim(),
        phone: _phoneController.text.trim(),
        village: widget.village,
        destination: _destination,
        destinationCategory: category,
        groupSize: _groupSize,
        conductorId: widget.conductorId,
      );
      widget.onSignalSent(waitId);
    } catch (e) {
      setState(() => _loading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }
}

// =============================================================================
// AddTaxiSheet — conductor adds a new taxi to the fleet
// =============================================================================

class AddTaxiSheet extends StatefulWidget {
  final String conductorId;
  final String village;

  const AddTaxiSheet({super.key, required this.conductorId, required this.village});

  @override
  State<AddTaxiSheet> createState() => _AddTaxiSheetState();
}

class _AddTaxiSheetState extends State<AddTaxiSheet> {
  final _svc = FirebaseService.instance;
  final _driverNameCtrl = TextEditingController();
  final _plateCtrl = TextEditingController();

  String _destination = 'Town Market';
  DestinationCategory _category = DestinationCategory.market;
  String _vehicleType = '14-Seater';
  int _seats = 14;
  int _eta = 0;
  bool _loading = false;

  static const _vehicleTypes = ['7-Seater', '10-Seater', '14-Seater', '22-Seater'];
  static const _destinations = [
    ('Town Market', DestinationCategory.market),
    ('Hospital', DestinationCategory.hospital),
    ('Bus Station', DestinationCategory.busStation),
    ('School', DestinationCategory.school),
  ];

  @override
  void dispose() {
    _driverNameCtrl.dispose();
    _plateCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('➕ Add Taxi to Fleet',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
          const SizedBox(height: 16),
          TextField(
            controller: _driverNameCtrl,
            decoration: const InputDecoration(labelText: 'Driver Name', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _plateCtrl,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(labelText: 'Vehicle Plate', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: _destination,
                  decoration: const InputDecoration(labelText: 'Destination', border: OutlineInputBorder()),
                  items: _destinations
                      .map((e) => DropdownMenuItem(value: e.$1, child: Text(e.$1)))
                      .toList(),
                  onChanged: (v) {
                    if (v == null) return;
                    final match = _destinations.firstWhere((e) => e.$1 == v);
                    setState(() { _destination = v; _category = match.$2; });
                  },
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: _vehicleType,
                  decoration: const InputDecoration(labelText: 'Type', border: OutlineInputBorder()),
                  items: _vehicleTypes
                      .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                      .toList(),
                  onChanged: (v) {
                    if (v == null) return;
                    setState(() {
                      _vehicleType = v;
                      _seats = int.parse(v.split('-').first);
                    });
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: _loading ? null : _addTaxi,
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.black87,
              foregroundColor: Colors.white,
              minimumSize: const Size(double.infinity, 50),
            ),
            child: _loading
                ? const CircularProgressIndicator(color: Colors.white)
                : const Text('✅ ADD TO FLEET', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Future<void> _addTaxi() async {
    if (_driverNameCtrl.text.trim().isEmpty || _plateCtrl.text.trim().isEmpty) return;
    setState(() => _loading = true);

    final taxi = Taxi(
      id: '',
      driverName: _driverNameCtrl.text.trim(),
      vehiclePlate: _plateCtrl.text.trim().toUpperCase(),
      vehicleType: _vehicleType,
      destination: _destination,
      destinationCategory: _category,
      status: _eta == 0 ? TaxiStatus.boarding : TaxiStatus.available,
      seatsAvailable: _seats,
      totalSeats: _seats,
      eta: _eta,
      conductorId: widget.conductorId,
      village: widget.village,
      lastUpdated: DateTime.now().millisecondsSinceEpoch,
    );

    await _svc.addTaxi(taxi);
    if (mounted) Navigator.pop(context);
  }
}

// =============================================================================
// AnnouncementSheet — conductor posts an announcement
// =============================================================================

class AnnouncementSheet extends StatefulWidget {
  final String conductorId;
  final String village;

  const AnnouncementSheet({super.key, required this.conductorId, required this.village});

  @override
  State<AnnouncementSheet> createState() => _AnnouncementSheetState();
}

class _AnnouncementSheetState extends State<AnnouncementSheet> {
  final _svc = FirebaseService.instance;
  final _msgCtrl = TextEditingController();
  Duration _expiresIn = const Duration(hours: 6);
  bool _loading = false;

  @override
  void dispose() { _msgCtrl.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('📢 Post Announcement',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
          const SizedBox(height: 16),
          TextField(
            controller: _msgCtrl,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Message',
              hintText: 'e.g. Heavy traffic on main road. Expect 15 min delays.',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<Duration>(
            value: _expiresIn,
            decoration: const InputDecoration(labelText: 'Expires in', border: OutlineInputBorder()),
            items: const [
              DropdownMenuItem(value: Duration(hours: 1), child: Text('1 hour')),
              DropdownMenuItem(value: Duration(hours: 6), child: Text('6 hours')),
              DropdownMenuItem(value: Duration(hours: 12), child: Text('12 hours')),
              DropdownMenuItem(value: Duration(hours: 24), child: Text('24 hours')),
            ],
            onChanged: (v) { if (v != null) setState(() => _expiresIn = v); },
          ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: _loading ? null : _post,
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.orange,
              foregroundColor: Colors.white,
              minimumSize: const Size(double.infinity, 50),
            ),
            child: _loading
                ? const CircularProgressIndicator(color: Colors.white)
                : const Text('📢 POST TO ALL PASSENGERS', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Future<void> _post() async {
    if (_msgCtrl.text.trim().isEmpty) return;
    setState(() => _loading = true);
    await _svc.postAnnouncement(
      conductorId: widget.conductorId,
      village: widget.village,
      message: _msgCtrl.text.trim(),
      expiresIn: _expiresIn,
    );
    if (mounted) Navigator.pop(context);
  }
}

// =============================================================================
// AnnouncementBanner — shown at top of passenger screen
// =============================================================================

class AnnouncementBanner extends StatelessWidget {
  final String village;

  const AnnouncementBanner({super.key, required this.village});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Map<String, dynamic>>>(
      stream: FirebaseService.instance.announcementsStream(village),
      builder: (_, snap) {
        final announcements = snap.data ?? [];
        if (announcements.isEmpty) return const SizedBox.shrink();
        final latest = announcements.last;
        return Container(
          width: double.infinity,
          color: Colors.orange.shade100,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: [
              const Icon(Icons.campaign, color: Colors.orange),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  latest['message'] as String? ?? '',
                  style: const TextStyle(fontWeight: FontWeight.w500),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
