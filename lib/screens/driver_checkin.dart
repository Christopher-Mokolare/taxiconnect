import 'package:flutter/material.dart';
import 'package:firebase_database/firebase_database.dart';
import '../models/models.dart';
import '../services/firebase_service.dart';

class DriverCheckinScreen extends StatefulWidget {
  final String driverName;
  final String vehiclePlate;
  final String vehicleType;
  final String conductorId;
  final String village;

  const DriverCheckinScreen({
    super.key,
    required this.driverName,
    required this.vehiclePlate,
    required this.vehicleType,
    required this.conductorId,
    required this.village,
  });

  @override
  State<DriverCheckinScreen> createState() => _DriverCheckinScreenState();
}

class _DriverCheckinScreenState extends State<DriverCheckinScreen> {
  final _svc = FirebaseService.instance;

  String? _selectedDestination;
  DestinationCategory _selectedCategory = DestinationCategory.market;
  String _destinationDetails = '';
  int _seatsAvailable = 14;
  int _etaMinutes = 0; // 0 = already here
  bool _isLive = false;
  String? _activeTaxiId;
  bool _loading = false;

  static const _destinations = [
    ('Town Market', DestinationCategory.market),
    ('Hospital', DestinationCategory.hospital),
    ('Bus Station', DestinationCategory.busStation),
    ('School', DestinationCategory.school),
    ('Church', DestinationCategory.church),
  ];

  static const _etaOptions = [
    (0, 'Already here'),
    (5, '5 mins'),
    (15, '15 mins'),
    (30, '30 mins'),
    (60, '1 hour'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F5),
      appBar: AppBar(
        title: const Text('🚗 Driver Check-In'),
        backgroundColor: Colors.black87,
        foregroundColor: Colors.white,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Driver info header
            Card(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    const CircleAvatar(
                      backgroundColor: Colors.black87,
                      child: Icon(Icons.person, color: Colors.white),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(widget.driverName,
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                        Text('${widget.vehiclePlate} · ${widget.vehicleType}',
                            style: const TextStyle(color: Colors.grey)),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            if (!_isLive) ...[
              // Destination selection
              const Text('📍 Where are you going?',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              const SizedBox(height: 8),
              Card(
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                child: Column(
                  children: _destinations.map((entry) {
                    final (label, category) = entry;
                    final info = DestinationInfo.forCategory(category);
                    final selected = _selectedDestination == label;
                    return ListTile(
                      leading: Text(info.emoji, style: const TextStyle(fontSize: 22)),
                      title: Text(label),
                      trailing: selected
                          ? const Icon(Icons.check_circle, color: Colors.green)
                          : null,
                      tileColor: selected ? Colors.green.shade50 : null,
                      onTap: () => setState(() {
                        _selectedDestination = label;
                        _selectedCategory = category;
                      }),
                    );
                  }).toList(),
                ),
              ),
              const SizedBox(height: 12),

              // Optional destination detail
              TextField(
                decoration: const InputDecoration(
                  labelText: 'Destination details (optional)',
                  hintText: 'e.g. Main Market, Stage 4',
                  border: OutlineInputBorder(),
                  filled: true,
                  fillColor: Colors.white,
                ),
                onChanged: (v) => _destinationDetails = v,
              ),
              const SizedBox(height: 16),

              // Seat count
              const Text('🪑 Seats available',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              const SizedBox(height: 8),
              Card(
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.remove_circle_outline),
                        onPressed: _seatsAvailable > 1
                            ? () => setState(() => _seatsAvailable--)
                            : null,
                      ),
                      Text('$_seatsAvailable seats',
                          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                      IconButton(
                        icon: const Icon(Icons.add_circle_outline),
                        onPressed: _seatsAvailable < 22
                            ? () => setState(() => _seatsAvailable++)
                            : null,
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // ETA selection
              const Text('⏱️ ETA to village stop',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: _etaOptions.map((entry) {
                  final (mins, label) = entry;
                  final selected = _etaMinutes == mins;
                  return ChoiceChip(
                    label: Text(label),
                    selected: selected,
                    selectedColor: Colors.black87,
                    labelStyle: TextStyle(color: selected ? Colors.white : Colors.black),
                    onSelected: (_) => setState(() => _etaMinutes = mins),
                  );
                }).toList(),
              ),
              const SizedBox(height: 24),

              // GO LIVE button
              ElevatedButton.icon(
                onPressed: _selectedDestination == null || _loading ? null : _goLive,
                icon: _loading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.broadcast_on_personal),
                label: Text(
                  _selectedDestination != null
                      ? '✅ GO LIVE — $_selectedDestination'
                      : '✅ GO LIVE',
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 56),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ] else ...[
              // LIVE state — show status and go-offline option
              Card(
                color: Colors.green.shade50,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: const BorderSide(color: Colors.green, width: 2),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    children: [
                      const Icon(Icons.broadcast_on_personal, color: Colors.green, size: 48),
                      const SizedBox(height: 8),
                      const Text('YOU ARE LIVE',
                          style: TextStyle(
                              color: Colors.green, fontWeight: FontWeight.bold, fontSize: 20)),
                      const SizedBox(height: 4),
                      Text('📍 $_selectedDestination',
                          style: const TextStyle(fontSize: 16)),
                      Text('🪑 $_seatsAvailable seats · ${widget.vehiclePlate}',
                          style: const TextStyle(color: Colors.grey)),
                      const SizedBox(height: 16),
                      const Text(
                        'Passengers can see your taxi.\nConductor has been notified.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.black54),
                      ),
                      const SizedBox(height: 16),
                      OutlinedButton.icon(
                        onPressed: _goOffline,
                        icon: const Icon(Icons.stop_circle_outlined, color: Colors.red),
                        label: const Text('Go Offline', style: TextStyle(color: Colors.red)),
                        style: OutlinedButton.styleFrom(side: const BorderSide(color: Colors.red)),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _goLive() async {
    if (_selectedDestination == null) return;
    setState(() => _loading = true);

    try {
      final taxi = Taxi(
        id: '',
        driverName: widget.driverName,
        vehiclePlate: widget.vehiclePlate,
        vehicleType: widget.vehicleType,
        destination: _selectedDestination!,
        destinationCategory: _selectedCategory,
        destinationDetails: _destinationDetails.isEmpty ? null : _destinationDetails,
        status: _etaMinutes == 0 ? TaxiStatus.boarding : TaxiStatus.available,
        seatsAvailable: _seatsAvailable,
        totalSeats: _seatsAvailable,
        eta: _etaMinutes,
        conductorId: widget.conductorId,
        village: widget.village,
        lastUpdated: DateTime.now().millisecondsSinceEpoch,
      );

      final taxiId = await _svc.addTaxi(taxi);
      await _svc.subscribeAsDriver(widget.village);

      setState(() {
        _isLive = true;
        _activeTaxiId = taxiId;
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _goOffline() async {
    if (_activeTaxiId == null) return;
    await _svc.removeTaxi(_activeTaxiId!);
    setState(() {
      _isLive = false;
      _activeTaxiId = null;
    });
  }
}
