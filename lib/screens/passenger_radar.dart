import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/firebase_service.dart';
import '../widgets/taxi_card.dart';
import '../widgets/waiting_sheet.dart';
import '../widgets/announcement_banner.dart';

class PassengerRadarScreen extends StatefulWidget {
  final String village;
  final String conductorId;

  const PassengerRadarScreen({
    super.key,
    required this.village,
    required this.conductorId,
  });

  @override
  State<PassengerRadarScreen> createState() => _PassengerRadarScreenState();
}

class _PassengerRadarScreenState extends State<PassengerRadarScreen> {
  final _svc = FirebaseService.instance;

  String _selectedDestination = '';
  String? _activeWaitId;

  static const _destinations = [
    'Town Market',
    'Hospital',
    'Bus Station',
    'School',
    'Church',
  ];

  @override
  void initState() {
    super.initState();
    _loadLastDestination();
  }

  Future<void> _loadLastDestination() async {
    final last = await _svc.getLastDestination();
    if (mounted) {
      setState(() => _selectedDestination = last ?? _destinations.first);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F5),
      appBar: AppBar(
        title: Text('🚕 ${widget.village}'),
        backgroundColor: Colors.black87,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.phone),
            tooltip: 'Call Conductor',
            onPressed: () {/* launch phone dialer */},
          ),
        ],
      ),
      body: Column(
        children: [
          // Announcement banner
          AnnouncementBanner(village: widget.village),

          // Destination filter
          _DestinationFilter(
            destinations: _destinations,
            selected: _selectedDestination,
            onChanged: (dest) {
              setState(() => _selectedDestination = dest);
              _svc.saveLastDestination(dest);
            },
          ),

          // Taxi list
          Expanded(
            child: StreamBuilder<List<Taxi>>(
              stream: _selectedDestination.isEmpty
                  ? _svc.activeTaxisStream(widget.village)
                  : _svc.taxisForDestinationStream(widget.village, _selectedDestination),
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }

                final taxis = snapshot.data ?? [];
                final myDestTaxis = taxis.where((t) => t.destination == _selectedDestination).toList();
                final otherTaxis = taxis.where((t) => t.destination != _selectedDestination).toList();

                return ListView(
                  padding: const EdgeInsets.all(12),
                  children: [
                    if (myDestTaxis.isNotEmpty) ...[
                      _SectionHeader(
                        label: 'Taxis to $_selectedDestination',
                        count: myDestTaxis.length,
                        color: Colors.green,
                      ),
                      ...myDestTaxis.map((t) => TaxiCard(taxi: t, showWatchButton: true)),
                    ],

                    if (myDestTaxis.isEmpty)
                      _NoTaxisCard(
                        destination: _selectedDestination,
                        isWaiting: _activeWaitId != null,
                        onWait: _showWaitingSheet,
                        onCancelWait: _cancelWait,
                      ),

                    if (otherTaxis.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      _SectionHeader(
                        label: 'Other Destinations',
                        count: otherTaxis.length,
                        color: Colors.orange,
                      ),
                      ...otherTaxis.map((t) => TaxiCard(
                            taxi: t,
                            showWatchButton: false,
                            onSwitchDestination: () => setState(
                              () => _selectedDestination = t.destination,
                            ),
                          )),
                    ],
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  void _showWaitingSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => WaitingSheet(
        preselectedDestination: _selectedDestination,
        destinations: _destinations,
        village: widget.village,
        conductorId: widget.conductorId,
        onSignalSent: (waitId) {
          setState(() => _activeWaitId = waitId);
          Navigator.pop(context);
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('✅ Signal sent! Conductor has been alerted.'),
              backgroundColor: Colors.green,
              duration: Duration(seconds: 4),
            ),
          );
        },
      ),
    );
  }

  Future<void> _cancelWait() async {
    if (_activeWaitId == null) return;
    await _svc.cancelWaitingSignal(_activeWaitId!);
    setState(() => _activeWaitId = null);
  }
}

// =============================================================================
// WIDGETS
// =============================================================================

class _DestinationFilter extends StatelessWidget {
  final List<String> destinations;
  final String selected;
  final ValueChanged<String> onChanged;

  const _DestinationFilter({
    required this.destinations,
    required this.selected,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          const Icon(Icons.location_on, color: Colors.red, size: 20),
          const SizedBox(width: 8),
          const Text('Going to:', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: selected.isEmpty ? null : selected,
                hint: const Text('Select destination'),
                isExpanded: true,
                items: destinations
                    .map((d) => DropdownMenuItem(value: d, child: Text(d)))
                    .toList(),
                onChanged: (v) { if (v != null) onChanged(v); },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String label;
  final int count;
  final Color color;

  const _SectionHeader({required this.label, required this.count, required this.color});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Container(width: 4, height: 20, color: color),
          const SizedBox(width: 8),
          Text(
            '$label ($count)',
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
          ),
        ],
      ),
    );
  }
}

class _NoTaxisCard extends StatelessWidget {
  final String destination;
  final bool isWaiting;
  final VoidCallback onWait;
  final VoidCallback onCancelWait;

  const _NoTaxisCard({
    required this.destination,
    required this.isWaiting,
    required this.onWait,
    required this.onCancelWait,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Colors.red.shade50,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            const Icon(Icons.warning_amber_rounded, size: 40, color: Colors.red),
            const SizedBox(height: 8),
            Text(
              'No taxis to $destination right now',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 4),
            const Text(
              'Alert the Conductor that you\'re waiting.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.black54),
            ),
            const SizedBox(height: 12),
            if (!isWaiting)
              ElevatedButton.icon(
                onPressed: onWait,
                icon: const Icon(Icons.campaign),
                label: const Text("📢 I'M WAITING!"),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.red,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 50),
                  textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              )
            else
              Column(
                children: [
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.check_circle, color: Colors.green),
                      SizedBox(width: 6),
                      Text('Signal sent — Conductor notified',
                          style: TextStyle(color: Colors.green, fontWeight: FontWeight.w600)),
                    ],
                  ),
                  TextButton(
                    onPressed: onCancelWait,
                    child: const Text('Cancel signal', style: TextStyle(color: Colors.grey)),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
