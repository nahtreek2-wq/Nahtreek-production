import React, {useEffect, useRef, useState} from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
  IndiaLocale,
} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';
import {BottomSheet, Button, ChipRow, Icon, ICONS, Input} from './ui';
import {LocationPicker} from './LocationPicker';
import {PlusPerkStrip} from './PlusPerkStrip';
import type {SelectedLocation} from '../services/location';
import type {EngineerProfileDto, EngineerRequestDto} from '@nahtreek/types';

export type ConsultationPayload = {
  projectTitle: string;
  projectDescription: string;
  propertyType: string;
  projectSizeSqFt?: number;
  locationAddress: string;
  latitude: number;
  longitude: number;
  preferredStartDate?: string;
  budgetEstimate?: number;
};
interface Props {
  engineer: EngineerProfileDto;
  onClose: () => void;
  onTrack: (requestId: string) => void;
  onCreate: (payload: ConsultationPayload) => Promise<EngineerRequestDto>;
  planPrefill?: {title: string; description: string};
}
export function ConsultationSheet({
  engineer,
  onClose,
  onTrack,
  onCreate,
  planPrefill,
}: Props) {
  const services = engineer.specializations.length
    ? engineer.specializations
    : ['General consultation'];
  const [step, setStep] = useState(0);
  const [service, setService] = useState(services[0]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [propertyType, setPropertyType] = useState('Residential');
  const [sqft, setSqft] = useState('');
  const [budget, setBudget] = useState('');
  const [timing, setTiming] = useState('As soon as possible');
  const [date, setDate] = useState('');
  const [address, setAddress] = useState('');
  const [location, setLocation] = useState<SelectedLocation | null>(null);
  const [submitted, setSubmitted] = useState<EngineerRequestDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    // The AI plan loads after navigation; fill untouched fields when it lands.
    if (!planPrefill) return;
    setTitle(current => current || planPrefill.title);
    setDescription(current => current || planPrefill.description);
  }, [planPrefill]);
  const numberValid = (value: string, min: number) =>
    !value.trim() || (Number.isFinite(Number(value)) && Number(value) >= min);
  const dateValid =
    !date ||
    (/^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date &&
      Date.parse(date + 'T23:59:59') >= Date.now());
  const detailsValid =
    title.trim().length >= 3 &&
    description.trim().length >= 10 &&
    numberValid(sqft, 1) &&
    numberValid(budget, 0);
  const locationValid = location !== null && address.trim().length >= 5;
  const timingValid = timing === 'As soon as possible' || (!!date && dateValid);
  const valid = !!service && detailsValid && locationValid && timingValid;
  const steps = ['Service', 'Location', 'Details', 'When', 'Review & send'];
  const stepValid = [
    !!service,
    locationValid,
    detailsValid,
    timingValid,
    valid,
  ][step];
  const next = () => {
    if (!stepValid) {
      setError(
        [
          'Choose the service you need.',
          'Select a location and add the full address.',
          'Add a short title and at least 10 characters of detail.',
          'Choose ASAP or enter a valid future date.',
          'Review the information before sending.',
        ][step],
      );
      return;
    }
    setError('');
    setStep(current => Math.min(current + 1, steps.length - 1));
  };
  const submit = async () => {
    if (!valid || !location || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await onCreate({
        projectTitle: title.trim(),
        projectDescription: `${service}: ${description.trim()}`,
        propertyType,
        locationAddress: address.trim(),
        latitude: location.latitude,
        longitude: location.longitude,
        ...(sqft.trim() ? {projectSizeSqFt: Number(sqft)} : {}),
        ...(budget.trim() ? {budgetEstimate: Number(budget)} : {}),
        ...(timing === 'Choose a date' && date
          ? {preferredStartDate: new Date(date + 'T12:00:00').toISOString()}
          : {}),
      });
      setSubmitted(result);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Request could not be sent. Please try again.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  if (submitted)
    return (
      <BottomSheet visible title="Request submitted" onClose={onClose}>
        <View style={styles.successIcon}>
          <Icon name={ICONS.check} size={28} color={Colors.white} />
        </View>
        <Text style={styles.successTitle}>
          Your request is with the professional
        </Text>
        <Text style={styles.body}>
          We’ll let you know when {submitted.engineerName || engineer.fullName}{' '}
          responds.
        </Text>
        <View style={styles.summaryCard}>
          <Summary label="Request" value={submitted.projectTitle} />
          <Summary label="Status" value="Submitted" />
          <Summary label="Request ID" value={submitted.id} selectable />
          <Summary
            label="Sent"
            value={new Date(submitted.createdAt).toLocaleString('en-IN')}
          />
        </View>
        <View style={styles.actions}>
          <Button label="View request" onPress={() => onTrack(submitted.id)} />
          <Button label="Done" variant="secondary" onPress={onClose} />
        </View>
      </BottomSheet>
    );

  return (
    <BottomSheet
      visible
      title="Start a request"
      subtitle={
        engineer.fullName +
        ' · ' +
        (engineer.consultationFee == null
          ? 'Fee on request'
          : IndiaLocale.formatCurrency(engineer.consultationFee))
      }
      onClose={() => {
        if (!lock.current) onClose();
      }}>
      {planPrefill ? (
        <View style={styles.planBanner}>
          <Icon name={ICONS.sparkles} size={16} color={ClientColors.accentText} />
          <Text style={styles.planBannerText} numberOfLines={2}>
            From your AI plan: {planPrefill.title}
          </Text>
        </View>
      ) : null}
      <PlusPerkStrip consultFee={engineer.consultationFee ?? undefined} />
      <View style={styles.progressHeader}>
        <Text style={styles.stepCount}>
          STEP {step + 1} OF {steps.length}
        </Text>
        <Text style={styles.stepName}>{steps[step]}</Text>
      </View>
      <View style={styles.progressRow}>
        {steps.map((item, index) => (
          <View
            key={item}
            style={[
              styles.progressBar,
              index <= step && styles.progressBarActive,
            ]}
          />
        ))}
      </View>

      {step === 0 ? (
        <View>
          <Text style={styles.heading}>What do you need help with?</Text>
          <Text style={styles.body}>
            Choose the closest match. You can explain the details later.
          </Text>
          <ChipRow items={services} selected={service} onSelect={setService} />
        </View>
      ) : null}

      {step === 1 ? (
        <View>
          <Text style={styles.heading}>Where is the work?</Text>
          <Text style={styles.body}>
            This helps confirm service coverage and travel.
          </Text>
          {location ? (
            <View>
              <View style={styles.selectedLocation}>
                <Icon name={ICONS.location} size={20} color={Colors.navyMid} />
                <Text style={styles.selectedLocationText}>
                  {location.address}
                </Text>
              </View>
              <Button
                label="Change location"
                variant="secondary"
                onPress={() => setLocation(null)}
              />
              <Input
                label="Full address and directions"
                value={address}
                onChangeText={setAddress}
                multiline
                maxLength={500}
                placeholder="House number, street and landmark"
              />
            </View>
          ) : (
            <LocationPicker
              onSelect={item => {
                setLocation(item);
                setAddress(
                  item.address === 'Current location' ? '' : item.address,
                );
                setError('');
              }}
            />
          )}
        </View>
      ) : null}

      {step === 2 ? (
        <View>
          <Text style={styles.heading}>Tell us about the work</Text>
          <Input
            label="Request title"
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            placeholder="e.g. Inspect a wall crack"
          />
          <Text style={styles.fieldLabel}>Property type</Text>
          <ChipRow
            items={['Residential', 'Commercial', 'Land Plot']}
            selected={propertyType}
            onSelect={setPropertyType}
          />
          <View style={styles.fieldSpacer} />
          <Input
            label="What needs to be done?"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={4000}
            placeholder="Share the issue, scope and any useful context"
          />
          <Input
            label="Property size in sq.ft (optional)"
            value={sqft}
            onChangeText={setSqft}
            keyboardType="numeric"
          />
          <Input
            label="Budget in rupees (optional)"
            value={budget}
            onChangeText={setBudget}
            keyboardType="numeric"
          />
          {!numberValid(sqft, 1) || !numberValid(budget, 0) ? (
            <Text style={styles.error}>
              Enter a valid positive size and a budget of zero or more.
            </Text>
          ) : null}
        </View>
      ) : null}

      {step === 3 ? (
        <View>
          <Text style={styles.heading}>When do you need it?</Text>
          <Text style={styles.body}>
            You can confirm the final schedule with the professional.
          </Text>
          <ChipRow
            items={['As soon as possible', 'Choose a date']}
            selected={timing}
            onSelect={value => {
              setTiming(value);
              setError('');
            }}
          />
          {timing === 'Choose a date' ? (
            <View style={styles.dateField}>
              <Input
                label="Preferred date"
                value={date}
                onChangeText={setDate}
                maxLength={10}
                placeholder="YYYY-MM-DD"
              />
              {!dateValid ? (
                <Text style={styles.error}>
                  Enter a valid date today or later.
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {step === 4 ? (
        <View>
          <Text style={styles.heading}>Review and send</Text>
          <Text style={styles.body}>
            Your request will be sent to {engineer.fullName}. You can track its
            status and continue the conversation from Requests.
          </Text>
          <View style={styles.summaryCard}>
            <Summary label="Service" value={service} />
            <Summary label="Request" value={title} />
            <Summary
              label="Property"
              value={`${propertyType}${sqft ? ` · ${sqft} sq.ft` : ''}`}
            />
            <Summary label="Details" value={description} />
            <Summary label="Location" value={address} />
            <Summary
              label="When"
              value={timing === 'Choose a date' ? date : timing}
            />
            <Summary
              label="Budget"
              value={
                budget
                  ? IndiaLocale.formatCurrency(Number(budget))
                  : 'Discuss with professional'
              }
            />
          </View>
          <Text style={styles.privacyNote}>
            Your requirement and address will be shared only with this
            professional.
          </Text>
        </View>
      ) : null}

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <View
        style={[
          styles.actionsRow,
          step === steps.length - 1 && styles.actionsColumn,
        ]}>
        {step === steps.length - 1 ? (
          <>
            <Button
              label={busy ? 'Sending…' : 'Send request'}
              loading={busy}
              disabled={!valid || busy}
              onPress={() => void submit()}
            />
            <Button
              label="Back"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setError('');
                setStep(current => current - 1);
              }}
            />
          </>
        ) : (
          <>
            {step > 0 ? (
              <Button
                label="Back"
                variant="secondary"
                disabled={busy}
                onPress={() => {
                  setError('');
                  setStep(current => current - 1);
                }}
                style={styles.flexButton}
              />
            ) : null}
            <Button label="Next" onPress={next} style={styles.flexButton} />
          </>
        )}
      </View>
    </BottomSheet>
  );
}

function Summary({
  label,
  value,
  selectable,
}: {
  label: string;
  value: string;
  selectable?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text selectable={selectable} style={styles.summaryValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  planBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    marginBottom: 8,
  },
  planBannerText: {...Typography.caption, color: ClientColors.accentText, fontWeight: '700', flex: 1},
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepCount: {...Typography.badge, color: Colors.slate500},
  stepName: {...Typography.caption, fontWeight: '700', color: Colors.navyMid},
  progressRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  progressBar: {
    height: 4,
    flex: 1,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.slate200,
  },
  progressBarActive: {backgroundColor: ClientColors.accent},
  heading: {...Typography.h3, color: Colors.navyDeep, marginBottom: Spacing.xs},
  body: {...Typography.body, color: Colors.slate700, marginBottom: Spacing.sm},
  error: {...Typography.body, color: Colors.error, marginVertical: Spacing.sm},
  fieldLabel: {
    ...Typography.caption,
    fontWeight: '600',
    color: Colors.slate700,
    marginBottom: Spacing.xs,
  },
  fieldSpacer: {height: Spacing.md},
  dateField: {marginTop: Spacing.lg},
  selectedLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: ClientColors.border,
    marginBottom: Spacing.sm,
  },
  selectedLocationText: {...Typography.body, color: Colors.slate800, flex: 1},
  summaryCard: {
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.offWhite,
  },
  summaryRow: {
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.slate200,
  },
  summaryLabel: {...Typography.badge, color: Colors.slate500, marginBottom: 2},
  summaryValue: {...Typography.body, color: Colors.slate900},
  privacyNote: {
    ...Typography.caption,
    color: Colors.slate500,
    marginTop: Spacing.md,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
  },
  actionsColumn: {
    flexDirection: 'column',
  },
  actions: {gap: Spacing.sm, marginTop: Spacing.lg},
  flexButton: {flex: 1},
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.success,
    marginBottom: Spacing.md,
  },
  successTitle: {
    ...Typography.h2,
    color: Colors.navyDeep,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
});
