import React, {useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import {Button, Input} from './ui';
import {currentLocation, searchLocations, type SelectedLocation} from '../services/location';
import {Colors} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';

export function LocationPicker({onSelect, onSearching}: {onSelect: (location: SelectedLocation) => void; onSearching?: () => void}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SelectedLocation[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pendingVersion = useRef<number | null>(null);
  const selectionVersion = useRef(0);
  async function locate(current: boolean) {
    if (pendingVersion.current === selectionVersion.current) return;
    const version = ++selectionVersion.current;
    onSearching?.();
    pendingVersion.current = version; setBusy(true); setError('');
    try {
      if (current) {
        const location = await currentLocation();
        if (version === selectionVersion.current) onSelect(location);
      }
      else {
        const found = await searchLocations(query);
        if (version === selectionVersion.current) {
          setResults(found);
          if (!found.length) setError('No matching places. Try a street, city and postal code.');
        }
      }
    } catch (cause) { if (version === selectionVersion.current) setError(cause instanceof Error ? cause.message : 'Could not find your location. Search for your address instead.'); }
    finally { if (version === selectionVersion.current) {pendingVersion.current = null; setBusy(false);} }
  }
  return <View style={{gap: 12}}>
    <Button label="Use current location" variant="secondary" disabled={busy} onPress={() => void locate(true)} />
    <Input label="Search address or city" value={query} onChangeText={value => {selectionVersion.current++; pendingVersion.current = null; setBusy(false); setError(''); setQuery(value); setResults([]); onSearching?.();}} placeholder="Street, city or postal code" />
    <Button label={busy ? 'Finding location…' : 'Search places'} disabled={busy || query.trim().length < 3} onPress={() => void locate(false)} />
    {error ? <Text accessibilityRole="alert" style={{color: Colors.error}}>{error}</Text> : null}
    {results.map((item, index) => <Pressable key={index} accessibilityRole="button" onPress={() => {selectionVersion.current++; pendingVersion.current = null; setBusy(false); onSelect(item); setResults([]);}} style={{padding: 16, minHeight: 48, borderBottomWidth: 1, borderColor: Colors.slate100}}><Text style={{color: ClientColors.primaryText}}>{item.address}</Text></Pressable>)}
  </View>;
}
