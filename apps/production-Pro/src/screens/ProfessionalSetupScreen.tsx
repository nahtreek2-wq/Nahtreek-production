import {FormScrollView, useFormFieldFocus} from '../../../../packages/mobile-ui/FormScrollView';
import {ScreenHeader} from '../components/ScreenHeader';
import {ProLoader} from '../components/ProLoader';
import React, {useEffect, useRef, useState} from 'react';
import {StateDistrictPicker} from '../../../../packages/mobile-geography/StateDistrictPicker';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import type {ProfileStackParamList} from '../navigation/types';
import {api, ApiError} from '../services/apiClient';
import {
  currentLocation,
  searchLocation,
  type DeviceLocation,
} from '../services/location';
import {useSessionStore} from '../stores/session';
import {useProToast} from '../stores/proToast';
import {PrimaryButton} from '../components/PrimaryButton';
import {WorkPhotosSection} from '../components/WorkPhotosSection';

type ProfileResponse = {
  professionalType: 'CIVIL_ENGINEER' | 'SERVICE_PROFESSIONAL';
  profile: null | {
    id: string;
    fullName: string;
    title: string;
    bio?: string;
    yearsOfExperience: number;
    baseCity: string;
    baseState: string;
    baseLatitude?: number;
    baseLongitude?: number;
    serviceCategories: string[];
    startingPrice?: number;
    isAvailable: boolean;
    portfolioItems?: {id: string; title: string; description?: string; imageUrl: string}[];
    engineerProfile?: null | {
      qualificationDegree: string;
      institution: string;
      graduationYear: number;
      licenseNumber?: string;
      consultationFee?: number;
      specializations: {specializationId: string}[];
    };
  };
};
type ServiceCategory = {id: string; slug: string; title: string; group: string};
type Specialization = {id: string; name: string; description?: string};

export function ProfessionalSetupScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const queryClient = useQueryClient();
  const toast = useProToast();
  const user = useSessionStore(state => state.user);
  const updateUser = useSessionStore(state => state.updateUser);
  const profileQuery = useQuery({
    queryKey: ['professional-profile'],
    queryFn: () => api.get<ProfileResponse>('/professionals/me'),
  });
  const categories = useQuery({
    queryKey: ['service-categories'],
    queryFn: () => api.get<ServiceCategory[]>('/discovery/services'),
  });
  const specializations = useQuery({
    queryKey: ['engineer-specializations'],
    queryFn: () => api.get<Specialization[]>('/discovery/specializations'),
  });
  const initialized = useRef(false);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [title, setTitle] = useState('');
  const [bio, setBio] = useState('');
  const [experience, setExperience] = useState('');
  const [city, setCity] = useState(user?.city ?? '');
  const [state, setState] = useState(user?.state ?? '');
  const [coordinates, setCoordinates] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [qualification, setQualification] = useState('');
  const [institution, setInstitution] = useState('');
  const [graduationYear, setGraduationYear] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [price, setPrice] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState('');
  const engineer =
    profileQuery.data?.professionalType === 'CIVIL_ENGINEER' ||
    user?.roles.includes('ENGINEER');

  useEffect(() => {
    const profile = profileQuery.data?.profile;
    if (!profile || initialized.current || (!engineer && !categories.data)) {
      return;
    }
    initialized.current = true;
    setFullName(profile.fullName || user?.fullName || '');
    setTitle(profile.title || '');
    setBio(profile.bio || '');
    setExperience(String(profile.yearsOfExperience ?? ''));
    setCity(profile.baseCity || user?.city || '');
    setState(profile.baseState || user?.state || '');
    if (profile.baseLatitude != null && profile.baseLongitude != null) {
      setCoordinates({
        latitude: profile.baseLatitude,
        longitude: profile.baseLongitude,
      });
    }
    setSelected(
      engineer
        ? profile.engineerProfile?.specializations.map(
            item => item.specializationId,
          ) ?? []
        : profile.serviceCategories.map(value =>
            categories.data?.find(category => category.id === value || category.slug === value)?.slug ?? value,
          ),
    );
    setQualification(profile.engineerProfile?.qualificationDegree ?? '');
    setInstitution(profile.engineerProfile?.institution ?? '');
    setGraduationYear(
      profile.engineerProfile?.graduationYear
        ? String(profile.engineerProfile.graduationYear)
        : '',
    );
    setLicenseNumber(profile.engineerProfile?.licenseNumber ?? '');
    setPrice(
      String(
        engineer
          ? profile.engineerProfile?.consultationFee ?? ''
          : profile.startingPrice ?? '',
      ),
    );
  }, [
    categories.data,
    engineer,
    profileQuery.data?.profile,
    user?.city,
    user?.fullName,
    user?.state,
  ]);

  const applyLocation = (location: DeviceLocation) => {
    setCity(location.city || city);
    setState(location.state || state);
    setCoordinates({
      latitude: location.latitude,
      longitude: location.longitude,
    });
    setLocationError('');
  };
  const findLocation = async (current: boolean) => {
    setLocationBusy(true);
    setLocationError('');
    try {
      applyLocation(
        current
          ? await currentLocation()
          : await searchLocation(`${city}, ${state}`),
      );
    } catch (reason) {
      setLocationError(
        reason instanceof Error
          ? reason.message
          : 'Location could not be found.',
      );
    } finally {
      setLocationBusy(false);
    }
  };
  const submit = useMutation({
    mutationFn: async () => {
      if (!coordinates) {
        throw new ApiError(400, 'Find your work area before submitting.');
      }
      const amount = price.trim() ? Number(price) : undefined;
      return api.put('/professionals/me', {
        kind: engineer ? 'engineer' : 'service-provider',
        fullName: fullName.trim(),
        title: title.trim(),
        bio: bio.trim() || undefined,
        yearsOfExperience: Number(experience),
        baseCity: city.trim(),
        baseState: state.trim(),
        baseLatitude: coordinates.latitude,
        baseLongitude: coordinates.longitude,
        isAvailable: true,
        ...(engineer
          ? {
              specializationIds: selected,
              qualificationDegree: qualification.trim(),
              institution: institution.trim(),
              graduationYear: Number(graduationYear),
              licenseNumber: licenseNumber.trim() || undefined,
              consultationFee: amount,
            }
          : {serviceCategories: selected, startingPrice: amount}),
      });
    },
    onSuccess: async () => {
      updateUser({
        fullName: fullName.trim(),
        city: city.trim(),
        state: state.trim(),
        verificationStatus: 'PENDING',
        // Setup is complete server-side: without this the persisted session
        // still routes back to onboarding step 1 on every app restart.
        needsProfessionalProfile: false,
      });
      await queryClient.invalidateQueries({queryKey: ['professional-profile']});
      toast('Work details saved. Next, add your proof documents.', 'success');
      navigation.replace('VerificationDocuments');
    },
  });
  const choices = engineer
    ? (specializations.data ?? []).map(item => ({
        id: item.id,
        label: item.name,
      }))
    : (categories.data ?? []).map(item => ({id: item.slug, label: item.title}));
  const toggle = (id: string) =>
    setSelected(value =>
      value.includes(id) ? value.filter(item => item !== id) : [...value, id],
    );

  if (profileQuery.isPending) {
    return (
      <View style={styles.center}>
        <ProLoader size={52} label="Loading your profile…" />
      </View>
    );
  }
  return (
    <KeyboardAwareView style={styles.root}>
      <ScreenHeader
        title="Complete your profile"
        subtitle={engineer ? 'Civil Engineer' : 'Service Professional'}
        onBack={() => navigation.goBack()}
      />
      <FormScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}>
        <Text style={styles.step}>PROFESSIONAL DETAILS</Text>
        <Text style={styles.heading}>Tell clients about your work</Text>
        <Text style={styles.help}>
          Use clear, simple information. Your profile is reviewed before it
          becomes public.
        </Text>
        <View style={styles.form}>
          <Field
            label="Full name or business name"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Enter the name clients should see"
          />
          <Field
            label="Professional title"
            value={title}
            onChangeText={setTitle}
            placeholder={
              engineer
                ? 'Example: Structural Civil Engineer'
                : 'Example: Plumbing Professional'
            }
          />
          <Field
            label="About your work"
            value={bio}
            onChangeText={setBio}
            placeholder="Describe the work you do"
            multiline
          />
          <Field
            label="Years of experience"
            value={experience}
            onChangeText={setExperience}
            keyboardType="number-pad"
            placeholder="Example: 5"
          />
        </View>
        <Text style={styles.sectionTitle}>Main work area</Text>
        <View style={styles.form}>
          <StateDistrictPicker
            state={state}
            district={city}
            onStateChange={value => {
              setState(value);
              setCoordinates(null);
            }}
            onDistrictChange={value => {
              setCity(value);
              setCoordinates(null);
            }}
          />
          <View style={styles.locationActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Find this area"
              disabled={locationBusy}
              onPress={() => findLocation(false)}
              style={styles.secondary}>
              <MaterialCommunityIcons
                name="magnify"
                size={20}
                color={Colors.navyMid}
              />
              <Text style={styles.secondaryText}>Find this area</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use my location"
              disabled={locationBusy}
              onPress={() => findLocation(true)}
              style={styles.secondary}>
              <MaterialCommunityIcons
                name="crosshairs-gps"
                size={20}
                color={Colors.navyMid}
              />
              <Text style={styles.secondaryText}>Use my location</Text>
            </Pressable>
          </View>
          {coordinates ? (
            <Text style={styles.success}>✓ Work area confirmed</Text>
          ) : null}
          {locationError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {locationError}
            </Text>
          ) : null}
        </View>
        <Text style={styles.sectionTitle}>
          {engineer ? 'Engineering specializations' : 'Services you provide'}
        </Text>
        <Text style={styles.help}>
          Choose every approved area that applies to your work.
        </Text>
        {categories.isPending || specializations.isPending ? (
          <View style={styles.catalogLoading}>
            <ProLoader size={30} />
          </View>
        ) : (
          <View style={styles.chips}>
            {choices.map(item => (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{checked: selected.includes(item.id)}}
                key={item.id}
                onPress={() => toggle(item.id)}
                style={[
                  styles.chip,
                  selected.includes(item.id) && styles.chipActive,
                ]}>
                <Text
                  style={[
                    styles.chipText,
                    selected.includes(item.id) && styles.chipTextActive,
                  ]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {engineer ? (
          <>
            <Text style={styles.sectionTitle}>Qualification</Text>
            <View style={styles.form}>
              <Field
                label="Degree or qualification"
                value={qualification}
                onChangeText={setQualification}
                placeholder="Example: B.E. Civil Engineering"
              />
              <Field
                label="Institution"
                value={institution}
                onChangeText={setInstitution}
                placeholder="College or university"
              />
              <Field
                label="Graduation year"
                value={graduationYear}
                onChangeText={setGraduationYear}
                keyboardType="number-pad"
                placeholder="Example: 2020"
              />
              <Field
                label="License number (if applicable)"
                value={licenseNumber}
                onChangeText={setLicenseNumber}
                placeholder="Optional"
              />
            </View>
          </>
        ) : null}
        <Text style={styles.sectionTitle}>
          {engineer ? 'Consultation fee' : 'Starting price'}
        </Text>
        <Field
          label="Amount in ₹"
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          placeholder="Optional"
        />
        <Text style={styles.sectionTitle}>Work photos</Text>
        <Text style={styles.help}>
          Show customers your best completed work. You can add more photos
          later from your public profile.
        </Text>
        <WorkPhotosSection items={profileQuery.data?.profile?.portfolioItems ?? []} />
        {submit.error ? (
          <Text accessibilityRole="alert" style={styles.submitError}>
            {submit.error instanceof Error
              ? submit.error.message
              : 'Could not submit your profile.'}
          </Text>
        ) : null}
        <PrimaryButton
          label="Save and continue"
          loading={submit.isPending}
          onPress={() => submit.mutate()}
          style={styles.submit}
        />
        <Text style={styles.notice}>
          We send your profile to the admin only after you add the required
          proof documents on the next screen.
        </Text>
      </FormScrollView>
    </KeyboardAwareView>
  );
}

type FieldProps = React.ComponentProps<typeof TextInput> & {label: string};
function Field({label, multiline, ...props}: FieldProps) {
  const onFocus = useFormFieldFocus();
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        onFocus={props.onFocus ?? onFocus}
        multiline={multiline}
        accessibilityLabel={label}
        placeholderTextColor={Colors.slate500}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: Colors.offWhite},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.offWhite,
  },
  header: {
    minHeight: 92,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.navyDeep,
  },
  back: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  flex: {flex: 1, minWidth: 0},
  headerTitle: {...Typography.h2, color: Colors.white},
  headerSubtitle: {...Typography.caption, color: Colors.slate300},
  content: {padding: 20, paddingBottom: Spacing.xxl},
  step: {
    ...Typography.badge,
    lineHeight: 16,
    color: Colors.navyMid,
    letterSpacing: 1,
  },
  heading: {...Typography.h1, color: Colors.slate900, marginTop: Spacing.xs},
  help: {...Typography.body, color: Colors.slate600, marginTop: Spacing.xs},
  form: {gap: 20, marginTop: Spacing.lg},
  label: {
    ...Typography.caption,
    color: Colors.slate700,
    fontWeight: '700',
    marginBottom: Spacing.xs,
  },
  input: {
    ...Typography.body,
    minHeight: 52,
    color: Colors.slate900,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
  },
  multiline: {minHeight: 104, paddingTop: Spacing.md, textAlignVertical: 'top'},
  sectionTitle: {
    ...Typography.h2,
    color: Colors.slate900,
    marginTop: Spacing.lg,
  },
  locationActions: {gap: 12},
  secondary: {
    minHeight: 48,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.slate300,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.white,
  },
  secondaryText: {
    ...Typography.button,
    lineHeight: 22,
    color: Colors.navyMid,
    flexShrink: 1,
  },
  success: {...Typography.caption, color: Colors.success},
  error: {...Typography.caption, color: Colors.error},
  catalogLoading: {margin: Spacing.lg},
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  chip: {
    minHeight: 48,
    maxWidth: '100%',
    paddingVertical: 12,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.slate300,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.white,
  },
  chipActive: {borderColor: Colors.navyMid, backgroundColor: Colors.navyDeep},
  chipText: {...Typography.body, color: Colors.slate700},
  chipTextActive: {color: Colors.white, fontWeight: '700'},
  submitError: {...Typography.body, color: Colors.error, marginTop: Spacing.lg},
  submit: {marginTop: Spacing.lg},
  notice: {
    ...Typography.caption,
    color: Colors.slate500,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
});
