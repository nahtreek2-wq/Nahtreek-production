import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
} from 'react-native';
import {launchImageLibrary} from 'react-native-image-picker';
import {useQueryClient} from '@tanstack/react-query';
import {useNavigation} from '@react-navigation/native';
import {useBottomTabBarHeight} from '@react-navigation/bottom-tabs';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  Colors,
  Typography,
  Spacing,
  BorderRadius,
} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';
import {inrMonth} from '../utils/format';
import {Avatar, Icon, ICONS, BottomSheet, Button} from '../components/ui';
import {IconName} from '../components/ui/Icon';
import {StateDistrictFields} from '../components/StateDistrictFields';
import {useCity} from '../stores/city';
import {useSessionStore} from '../stores/session';
import {useToast} from '../stores/toast';
import {
  useClientProfile,
  useFavoritesList,
  useLogout,
  useUpdateClientProfile,
} from '../services/queries';
import {APP_NAME} from '../config/appConfig';
import type {RootStackParamList} from '../navigation/types';
import {saveProfilePhoto} from '../services/media';
import {isApiConfigured} from '../services/config';
import {fetchAiSubscription, type AiSubscriptionView} from '../services/aiBilling';
import {stateForCity} from '../services/geography';
import {DistrictLocationPicker} from '../components/DistrictLocationPicker';
import {validateClientDetails} from '../services/localCredentials';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const DEFAULT_CLIENT_NAME = 'NAHTREEK Client';

interface Row {
  icon: IconName;
  label: string;
  value?: string;
  valueColor?: string;
  danger?: boolean;
  onPress: () => void;
}

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const clearSession = useSessionStore(s => s.clearSession);
  const user = useSessionStore(s => s.user);
  const storageError = useSessionStore(s => s.storageError);
  const refreshToken = useSessionStore(s => s.refreshToken);
  const city = useCity(s => s.city);
  const selectedState = useCity(s => s.state);
  const setCity = useCity(s => s.setCity);
  const favorites = useFavoritesList();
  const updateUser = useSessionStore(s => s.updateUser);
  const toast = useToast();
  const clientProfile = useClientProfile();
  const updateProfile = useUpdateClientProfile();
  const logout = useLogout();
  const [citySheet, setCitySheet] = useState(false);
  const [editSheet, setEditSheet] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editState, setEditState] = useState('');
  const [editPostalCode, setEditPostalCode] = useState('');
  const [editAvatar, setEditAvatar] = useState<string | undefined>();
  const [savingPhoto, setSavingPhoto] = useState(false);
  const profileName =
    clientProfile.data?.fullName ?? user?.fullName ?? DEFAULT_CLIENT_NAME;
  const profileAvatar = clientProfile.data?.avatarUrl ?? user?.avatarUrl;

  const openEdit = () => {
    setEditName(profileName);
    setEditEmail(clientProfile.data?.email ?? user?.email ?? '');
    setEditAddress(clientProfile.data?.address ?? user?.address ?? '');
    setEditCity(
      clientProfile.data?.city ?? user?.homeCity ?? city.split(',')[0] ?? '',
    );
    setEditState(clientProfile.data?.state ?? user?.state ?? '');
    setEditPostalCode(clientProfile.data?.postalCode ?? user?.postalCode ?? '');
    setEditAvatar(profileAvatar);
    setEditSheet(true);
  };

  const choosePhoto = async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      quality: 0.7,
      maxWidth: 768,
      maxHeight: 768,
      includeBase64: true,
    });
    if (result.didCancel) return;
    if (result.errorCode) {
      toast(
        result.errorMessage ?? 'Could not open your photo library',
        'error',
      );
      return;
    }
    const uri = result.assets?.[0]?.uri;
    if (!uri || savingPhoto || updateProfile.isPending) return;
    const previousAvatar = editAvatar;
    const epoch = useSessionStore.getState().sessionEpoch;
    setEditAvatar(uri);
    setSavingPhoto(true);
    try {
      const avatarUrl = await saveProfilePhoto(
        result.assets![0] as {uri: string; base64?: string; type?: string},
      );
      if (useSessionStore.getState().sessionEpoch !== epoch) return;
      if (isApiConfigured) {
        // The upload endpoint commits avatarUrl. Avoid a second write that can fail
        // after the photo has already been saved.
        queryClient.setQueryData(['client-profile'], (current: typeof clientProfile.data) =>
          current ? {...current, avatarUrl} : current,
        );
        updateUser({avatarUrl});
        setEditAvatar(avatarUrl);
      } else {
        const profile = await updateProfile.mutateAsync({avatarUrl});
        if (useSessionStore.getState().sessionEpoch !== epoch ||
            profile.userId !== useSessionStore.getState().user?.id) return;
        setEditAvatar(profile.avatarUrl);
      }
      void queryClient.invalidateQueries({queryKey: ['client-profile']});
      toast('Profile photo saved to your account', 'success');
    } catch (error) {
      if (useSessionStore.getState().sessionEpoch === epoch) {
        setEditAvatar(previousAvatar);
        toast(error instanceof Error ? error.message : 'Could not save your photo', 'error');
      }
    } finally {
      setSavingPhoto(false);
    }
  };

  const saveEdit = async () => {
    const epoch = useSessionStore.getState().sessionEpoch;
    const name = editName.trim();
    if (name.length < 2 || savingPhoto || updateProfile.isPending) return;
    const detailsError = validateClientDetails({
      fullName: name,
      address: editAddress,
      city: editCity,
      state: editState,
      postalCode: editPostalCode,
    });
    if (detailsError) {
      toast(detailsError, 'error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editEmail.trim())) {
      toast('Enter a valid email address', 'error');
      return;
    }
    if (useSessionStore.getState().sessionEpoch !== epoch) return;
    updateProfile.mutate(
      {
        fullName: name,
        avatarUrl: editAvatar,
        email: editEmail.trim() || undefined,
        address: editAddress.trim() || undefined,
        city: editCity,
        state: editState.trim() || stateForCity(editCity),
        postalCode: editPostalCode.trim() || undefined,
      },
      {
        onSuccess: profile => {
          if (
            useSessionStore.getState().sessionEpoch !== epoch ||
            profile.userId !== useSessionStore.getState().user?.id
          )
            return;
          updateUser({
            fullName: profile.fullName,
            avatarUrl: profile.avatarUrl,
            email: profile.email,
            address: profile.address,
            homeCity: profile.city,
            state: profile.state,
          });
          setCity(profile.city ?? editCity, profile.state ?? editState);
          setEditSheet(false);
          toast('Profile updated', 'success');
        },
        onError: error =>
          toast(
            error instanceof Error
              ? error.message
              : 'Could not update your profile',
            'error',
          ),
      },
    );
  };

  const selectCity = (nextState: string, nextCity: string) => {
    updateProfile.mutate(
      {city: nextCity, state: nextState},
      {
        onSuccess: profile => {
          if (profile.userId !== useSessionStore.getState().user?.id) return;
          setCity(profile.city ?? nextCity, profile.state ?? nextState);
          updateUser({homeCity: profile.city ?? nextCity});
          setCitySheet(false);
        },
        onError: error =>
          toast(
            error instanceof Error
              ? error.message
              : 'Could not update your home location',
            'error',
          ),
      },
    );
  };

  const signOut = () => {
    logout.mutate(refreshToken, {onSettled: clearSession});
  };

  const [aiBilling, setAiBilling] = useState<AiSubscriptionView | null>(null);
  useEffect(() => {
    if (!isApiConfigured) return;
    fetchAiSubscription().then(setAiBilling).catch(() => undefined);
  }, []);

  const groups: {title: string; rows: Row[]}[] = [
    {
      title: 'My home',
      rows: [
        {
          icon: ICONS.ai,
          label: 'NAHTREEK AI Pro',
          value: aiBilling?.effective ? 'Active' : aiBilling ? inrMonth(aiBilling.feePaisa) : 'View plans',
          onPress: () => navigation.navigate('AiPlanner'),
        },
        {
          icon: ICONS.location,
          label: 'Home location',
          value: clientProfile.data?.city ?? city.split(',')[0],
          onPress: () => setCitySheet(true),
        },
        {
          icon: ICONS.edit,
          label: 'Personal details',
          value: 'Edit',
          onPress: openEdit,
        },
      ],
    },
    {
      title: 'My activity',
      rows: [
        {
          icon: ICONS.camera,
          label: 'Scan pro QR',
          value: 'Ratings',
          onPress: () => navigation.navigate('Scan'),
        },
        {
          icon: ICONS.heartOutline,
          label: 'Saved professionals',
          value: String(favorites.data.length),
          onPress: () => navigation.navigate('Saved'),
        },
        {
          icon: ICONS.requests,
          label: 'Request history',
          onPress: () => navigation.navigate('MainTabs', {screen: 'Requests'}),
        },
        {
          icon: ICONS.requests,
          label: 'Home service requests',
          onPress: () => navigation.navigate('ServiceHistory'),
        },
        {
          icon: ICONS.requests,
          label: 'Recent activity',
          onPress: () => navigation.navigate('ActivityHistory'),
        },
      ],
    },
    {
      title: 'Preferences',
      rows: [
        {
          icon: ICONS.bell,
          label: 'Notifications',
          onPress: () => navigation.navigate('Settings'),
        },
        {
          icon: ICONS.lock,
          label: 'Privacy and security',
          onPress: () => navigation.navigate('Settings'),
        },
      ],
    },
    {
      title: 'Support',
      rows: [
        {
          icon: ICONS.support,
          label: 'Help and support',
          onPress: () => navigation.navigate('Help'),
        },
        {icon: ICONS.logout, label: 'Log out', danger: true, onPress: signOut},
      ],
    },
  ];

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: tabBarHeight + 24}}>
        <View style={[styles.header, {paddingTop: insets.top + Spacing.md}]}>
          <View style={styles.headerTopRow}>
            <View style={styles.profileHero}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Change profile photo"
                activeOpacity={0.82}
                onPress={openEdit}
                style={styles.avatarAction}>
                <Avatar name={profileName} size={76} light uri={profileAvatar} />
                <View style={styles.avatarCamera}>
                  <Icon name={ICONS.camera} size={13} color={ClientColors.onAccent} />
                </View>
              </TouchableOpacity>
              <View style={styles.headerMeta}>
                <Text style={styles.profileKicker}>MY PROFILE</Text>
                <Text style={styles.name}>{profileName}</Text>
                <Text style={styles.contact}>
                  {user
                    ? `+91 ${user.phoneNumber
                        .replace(/\D/g, '')
                        .slice(-10)
                        .replace(/(\d{5})(\d{5})/, '$1 $2')}`
                    : 'No phone number available'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={openEdit}
              accessibilityRole="button"
              accessibilityLabel="Edit profile">
              <Icon name={ICONS.edit} size={18} color={Colors.navyDeep} />
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.body}>
          {storageError ? (
            <Text
              accessibilityRole="alert"
              style={{color: Colors.error, marginTop: 16}}>
              {storageError}
            </Text>
          ) : null}
          {groups.map(g => (
            <View key={g.title} style={styles.group}>
              <Text style={styles.groupTitle}>{g.title}</Text>
              <View style={styles.groupBody}>
                {g.rows.map((r, i) => (
                  <TouchableOpacity
                    key={r.label}
                    style={[styles.row, i > 0 && styles.rowDivider]}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel={r.label}
                    onPress={r.onPress}>
                    <Icon
                      name={r.icon}
                      size={19}
                      color={r.danger ? Colors.error : g.title === 'My home' || g.title === 'My activity' ? '#2563EB' : '#52627A'}
                      style={styles.rowIcon}
                    />
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                      style={[
                        styles.rowLabel,
                        r.danger && styles.rowLabelDanger,
                      ]}>
                      {r.label}
                    </Text>
                    {!!r.value && (
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={[
                          styles.rowValue,
                          {color: r.valueColor ?? Colors.slate500},
                        ]}
                        >
                        {r.value}
                      </Text>
                    )}
                    <Icon
                      name={ICONS.chevronRight}
                      size={16}
                      color={Colors.slate300}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}

          <Text style={styles.version}>{APP_NAME} v1.0.0 (1)</Text>
        </View>
      </ScrollView>

      <DistrictLocationPicker
        visible={citySheet}
        state={selectedState}
        district={city}
        onClose={() => setCitySheet(false)}
        onSelect={selectCity}
      />

      <BottomSheet
        visible={editSheet}
        title="Edit profile"
        subtitle="Keep your contact and location details current"
        onClose={() => setEditSheet(false)}>
        <TouchableOpacity
          style={styles.editAvatarWrap}
          onPress={() => void choosePhoto()}
          accessibilityRole="button"
          accessibilityLabel="Choose profile photo">
          <View style={styles.editAvatarBox}>
            <Avatar
              name={editName || profileName}
              size={72}
              light
              uri={editAvatar}
            />
            <View style={styles.editCamera}>
              <Icon name={ICONS.camera} size={14} color={Colors.white} />
            </View>
          </View>
          <Text style={styles.changePhoto}>{savingPhoto ? 'Saving photo…' : 'Change profile photo'}</Text>
        </TouchableOpacity>
        <Text style={styles.editLabel}>FULL NAME</Text>
        <TextInput
          style={styles.editInput}
          value={editName}
          onChangeText={setEditName}
          placeholder="Your name"
          placeholderTextColor={Colors.slate500}
          autoCapitalize="words"
          returnKeyType="done"
        />
        <Text style={[styles.editLabel, styles.editFieldGap]}>
          EMAIL ADDRESS
        </Text>
        <TextInput
          style={styles.editInput}
          value={editEmail}
          onChangeText={setEditEmail}
          placeholder="you@example.com"
          placeholderTextColor={Colors.slate500}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <View style={styles.editFieldGap}>
          <StateDistrictFields
            state={editState}
            district={editCity}
            onStateChange={setEditState}
            onDistrictChange={setEditCity}
          />
        </View>
        <Text style={[styles.editLabel, styles.editFieldGap]}>PIN CODE</Text>
        <TextInput
          style={styles.editInput}
          accessibilityLabel="PIN code"
          value={editPostalCode}
          onChangeText={value =>
            setEditPostalCode(value.replace(/\D/g, '').slice(0, 6))
          }
          placeholder="6-digit PIN code"
          keyboardType="numeric"
          maxLength={6}
        />
        <Text style={[styles.editLabel, styles.editFieldGap]}>
          HOUSE / STREET ADDRESS
        </Text>
        <TextInput
          style={[styles.editInput, styles.editInputMultiline]}
          value={editAddress}
          onChangeText={setEditAddress}
          placeholder="Street, area or nearby landmark"
          placeholderTextColor={Colors.slate500}
          multiline
          maxLength={300}
        />
        <View style={styles.editActions}>
          <Button
            variant="secondary"
            label="Cancel"
            onPress={() => setEditSheet(false)}
            style={styles.editActionBtn}
          />
          <Button
            variant="primary"
            label={updateProfile.isPending || savingPhoto ? 'Saving…' : 'Save'}
            onPress={() => {
              void saveEdit();
            }}
            disabled={
              updateProfile.isPending || savingPhoto || !editName.trim()
            }
            style={styles.editActionBtn}
          />
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F5F8',
  },
  header: {
    backgroundColor: Colors.navyDeep,
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  profileHero: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  editBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14, minHeight: 42, borderRadius: 21, backgroundColor: ClientColors.accentSoft},
  headerMeta: {
    flex: 1,
  },
  avatarAction: {width: 76, height: 76, borderRadius: 38},
  avatarCamera: {position: 'absolute', right: 0, bottom: 0, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: ClientColors.accent, borderWidth: 2, borderColor: Colors.navyDeep},
  name: {
    ...Typography.h1,
    color: Colors.white,
  },
  profileKicker: {
    ...Typography.badge,
    color: ClientColors.white,
    letterSpacing: 1.1,
    marginBottom: 3,
  },
  contact: {
    ...Typography.caption,
    color: Colors.slate300,
    marginTop: 3,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: Spacing.xl,
  },
  group: {
    marginTop: 24,
  },
  groupBody: {backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden'},
  groupTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: '#111F35',
    marginBottom: 12,
    marginLeft: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingVertical: Spacing.md - 1,
    paddingHorizontal: Spacing.md,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: Colors.slate100,
  },
  rowIcon: {
    marginRight: Spacing.sm + 4,
  },
  rowLabel: {
    ...Typography.body,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: Colors.slate800,
    flex: 1,
  },
  rowLabelDanger: {
    color: Colors.error,
  },
  rowValue: {
    ...Typography.caption,
    maxWidth: 120,
    marginRight: Spacing.xs,
  },
  version: {
    ...Typography.badge,
    color: Colors.slate400,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.slate100,
  },
  cityLabel: {
    ...Typography.body,
    color: Colors.slate800,
    flex: 1,
  },
  editBtnText: {fontSize: 14, fontWeight: '700', color: '#111F35'},
  editAvatarWrap: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  editAvatarBox: {
    width: 72,
    height: 72,
  },
  editCamera: {
    position: 'absolute',
    right: -4,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.navyDeep,
    borderWidth: 2,
    borderColor: Colors.offWhite,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePhoto: {
    ...Typography.caption,
    fontWeight: '700',
    color: Colors.navyMid,
    marginTop: Spacing.sm,
  },
  editLabel: {
    ...Typography.badge,
    color: Colors.slate500,
    letterSpacing: 1,
    marginBottom: Spacing.xs,
  },
  editInput: {
    minHeight: 48,
    ...Typography.body,
    color: Colors.slate900,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  editInputMultiline: {
    minHeight: 76,
    textAlignVertical: 'top',
  },
  editFieldGap: {
    marginTop: Spacing.md,
  },
  editActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  editActionBtn: {
    flex: 1,
  },
});
