import React, {useEffect, useState} from 'react';
import {
  Alert,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {launchImageLibrary} from 'react-native-image-picker';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useBottomTabBarHeight} from '@react-navigation/bottom-tabs';
import {Colors} from '@nahtreek/design-system';
import {ScreenHeader} from '../components/ScreenHeader';
import {ScrollMotionBar, useScrollMotion} from '../components/ScrollMotionBar';
import {useProfessionalDraft} from '../stores/professional';
import {useSessionStore} from '../stores/session';
import {useProToast} from '../stores/proToast';
import {api} from '../services/apiClient';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useQuery} from '@tanstack/react-query';
import type {ProfileStackParamList} from '../navigation/types';
import {mediaUrl, saveProfessionalPhoto} from '../services/media';
import {useQueryClient} from '@tanstack/react-query';
import {MotionReveal} from '../components/MotionReveal';
import {ProIconChip, type IconChipTone} from '../components/ProIconChip';
import {ProLoader} from '../components/ProLoader';
import {WorkVisual} from '../components/WorkVisual';
import {ProColors, ProSpacing, ProType} from '../theme/professionalTheme';
import {useReducedMotion} from '../../../../packages/mobile-ui/useReducedMotion';

type ProfileResponse = {
  profile: null | {
    avatarUrl?: string;
    fullName?: string;
    title?: string;
    bio?: string;
    baseCity?: string;
    serviceCategories?: string[];
    engineerProfile?: {specializations?: {specializationId: string}[]};
    portfolioItems?: {id: string}[];
    verificationStatus: string;
    rating?: number | null;
    averageRating?: number | null;
    reviewCount?: number;
    totalReviewsCount?: number;
    completedJobs?: number;
    reviewsReceived?: {id: string}[];
  };
};

type ProfileActionRowProps = {
  icon: string;
  title: string;
  description: string;
  last?: boolean;
  tone?: IconChipTone;
  onPress: () => void;
};

function ProfileActionRow({
  icon,
  title,
  description,
  last = false,
  tone = 'blue',
  onPress,
}: ProfileActionRowProps) {
  const reducedMotion = useReducedMotion();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={`Opens ${title.toLowerCase()}`}
      onPress={onPress}
      style={({pressed}) => [
        styles.actionRow,
        last && styles.actionRowLast,
        pressed && (reducedMotion ? styles.rowPressed : styles.actionRowPressed),
      ]}>
      <ProIconChip name={icon} tone={tone} size={44} iconSize={23} />
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowText}>{description}</Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={22}
        color={ProColors.muted}
      />
    </Pressable>
  );
}

export function ProfileScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const scrollMotion = useScrollMotion();
  const navigation =
    useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const queryClient = useQueryClient();
  const toast = useProToast();
  const draft = useProfessionalDraft();
  const user = useSessionStore(state => state.user);
  const updateUser = useSessionStore(state => state.updateUser);
  const clear = useSessionStore(state => state.clear);
  const refreshToken = useSessionStore(state => state.refreshToken);
  const [signingOut, setSigningOut] = useState(false);
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const canDelete = /^\d{6}$/.test(deleteCode) && deleteConfirm.trim() === 'DELETE' && !deleting;
  const sendDeleteCode = () => {
    const identifier = user?.email?.includes('@')
      ? {email: user.email}
      : user?.phoneNumber
      ? {phoneNumber: user.phoneNumber}
      : null;
    if (!identifier) {
      setDeleteError('Your contact details are missing. Please sign in again.');
      return;
    }
    setSendingCode(true);
    setDeleteError('');
    api.post('email' in identifier ? '/auth/email-otp/request' : '/auth/otp/request', identifier)
      .then(() => setCodeSent(true))
      .catch(error => setDeleteError(error instanceof Error ? error.message : 'Could not send the code.'))
      .finally(() => setSendingCode(false));
  };
  const deleteAccount = () => {
    if (!canDelete) return;
    Alert.alert('Delete account?', 'This signs you out on all devices and closes your NAHTREEK account. Settle any commission dues first — deletion is blocked while money is owed.', [
      {text: 'Keep account', style: 'cancel'},
      {text: 'Delete', style: 'destructive', onPress: () => {
        setDeleting(true);
        setDeleteError('');
        api.delete<{deleted: boolean}>('/auth/me', {code: deleteCode})
          .then(() => clear())
          .catch(error => {
            setDeleting(false);
            setDeleteError(error instanceof Error ? error.message : 'Could not delete the account.');
          });
      }},
    ]);
  };
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const profile = useQuery({
    queryKey: ['professional-profile'],
    queryFn: () => api.get<ProfileResponse>('/professionals/me'),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
  const role = (
    user
      ? user.roles.includes('ENGINEER')
      : draft.professionalType === 'CIVIL_ENGINEER'
  )
    ? 'Civil Engineer'
    : 'Service Professional';
  const name = user?.fullName || draft.displayName;
  const city = user?.city || draft.city;
  const verificationStatus =
    profile.data?.profile?.verificationStatus ??
    user?.verificationStatus ??
    'NOT_SUBMITTED';
  const verificationTitle =
    verificationStatus === 'VERIFIED'
      ? 'Profile verified'
      : verificationStatus === 'PENDING' ||
        verificationStatus === 'UNDER_REVIEW'
      ? 'Verification in progress'
      : verificationStatus === 'REJECTED'
      ? 'Profile changes required'
      : 'Verification not submitted';
  const verificationText =
    verificationStatus === 'VERIFIED'
      ? 'Your approved professional profile can receive eligible work.'
      : verificationStatus === 'PENDING' ||
        verificationStatus === 'UNDER_REVIEW'
      ? 'NAHTREEK is reviewing your submitted information.'
      : verificationStatus === 'REJECTED'
      ? 'Open professional details and update the requested information.'
      : 'Complete the required professional details before review.';
  const avatarUrl = profile.data?.profile?.avatarUrl ?? user?.avatarUrl;
  const profileFields = profile.data?.profile;
  const readiness = profileFields ? [
    {name: 'Name', ready: Boolean(profileFields.fullName || name)},
    {name: 'Work title', ready: Boolean(profileFields.title)},
    {name: 'About your work', ready: Boolean(profileFields.bio)},
    {name: 'Work area', ready: Boolean(profileFields.baseCity || city)},
    {name: role === 'Civil Engineer' ? 'Specialization' : 'Services', ready: role === 'Civil Engineer' ? Boolean(profileFields.engineerProfile?.specializations?.length) : Boolean(profileFields.serviceCategories?.length)},
  ] : [];
  const readyCount = readiness.filter(item => item.ready).length;
  const reviewCount =
    profileFields?.reviewCount ??
    profileFields?.totalReviewsCount ??
    profileFields?.reviewsReceived?.length ??
    0;
  const rating = profileFields?.rating ?? profileFields?.averageRating;
  const isVerified = verificationStatus === 'VERIFIED';
  const isUnderReview =
    verificationStatus === 'PENDING' || verificationStatus === 'UNDER_REVIEW';
  const isRejected = verificationStatus === 'REJECTED';
  const showFullProfile = isVerified || (profile.isError && !profileFields);
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => setAvatarFailed(false), [avatarUrl]);
  const choosePhoto = async () => {
    if (savingPhoto) {
      return;
    }
    setPhotoError('');
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      includeBase64: true,
      quality: 0.7,
      maxWidth: 1200,
      maxHeight: 1200,
    });
    if (result.didCancel) {
      return;
    }
    const photo = result.assets?.[0];
    if (result.errorCode || !photo?.uri) {
      setPhotoError(result.errorMessage || 'Could not open this photo.');
      return;
    }
    setSavingPhoto(true);
    try {
      const saved = await saveProfessionalPhoto({
        uri: photo.uri,
        base64: photo.base64,
        type: photo.type,
      });
      updateUser({avatarUrl: saved});
      await queryClient.invalidateQueries({queryKey: ['professional-profile']});
      toast('Profile photo updated.', 'success');
    } catch (error) {
      setPhotoError(
        error instanceof Error ? error.message : 'Could not save your photo.',
      );
    } finally {
      setSavingPhoto(false);
    }
  };
  const signOut = async () => {
    if (signingOut) {
      return;
    }
    setSigningOut(true);
    try {
      if (refreshToken) {
        await api.post('/auth/logout', {refreshToken});
      }
    } finally {
      draft.resetDraft();
      clear();
    }
  };
  return (
    <View style={styles.root}>
      <ScreenHeader
        title="My profile"
        subtitle="Your details, work and settings"
      />
      <ScrollMotionBar offset={scrollMotion.offset} reducedMotion={scrollMotion.reducedMotion} />
      <Animated.ScrollView
        onScroll={scrollMotion.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, {paddingBottom: tabBarHeight + ProSpacing.xxl}]}>
        <MotionReveal>
          <View style={styles.identity}>
            <View style={styles.identityTop}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change profile photo"
                accessibilityHint="Choose a new photo from your device"
                disabled={savingPhoto}
                onPress={choosePhoto}
                style={({pressed}) => [
                  styles.avatar,
                  pressed && !savingPhoto && styles.avatarPressed,
                ]}>
                {avatarUrl && !avatarFailed ? (
                  <Image
                    source={{uri: mediaUrl(avatarUrl)}}
                    style={styles.avatarImage}
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <Text style={styles.avatarInitial}>
                    {(name || 'N').trim().charAt(0).toUpperCase()}
                  </Text>
                )}
                {savingPhoto ? (
                  <View style={styles.photoBusy}>
                    <ProLoader size={28} tone="light" />
                  </View>
                ) : (
                  <View style={styles.camera}>
                    <MaterialCommunityIcons
                      name="camera"
                      size={15}
                      color={ProColors.deep}
                    />
                  </View>
                )}
              </Pressable>
              <View style={styles.identityCopy}>
                <Text accessibilityRole="header" numberOfLines={2} style={styles.name}>
                  {name || 'Complete your profile'}
                </Text>
                {showFullProfile ? (
                  <>
                    <View style={styles.identityMeta}>
                      <MaterialCommunityIcons
                        name={role === 'Civil Engineer' ? 'hard-hat' : 'tools'}
                        size={15}
                        color={ProColors.secondary}
                      />
                      <Text style={styles.meta}>{role}</Text>
                    </View>
                    <View style={styles.identityMeta}>
                      <MaterialCommunityIcons
                        name="map-marker-outline"
                        size={15}
                        color={ProColors.secondary}
                      />
                      <Text style={styles.meta} numberOfLines={1}>
                        {city || 'Add your work area'}
                      </Text>
                    </View>
                  </>
                ) : (
                  <View style={styles.identityMeta}>
                    <MaterialCommunityIcons
                      name="clock-check-outline"
                      size={15}
                      color={ProColors.secondary}
                    />
                    <Text style={styles.meta}>
                      {isUnderReview
                        ? 'Verification in progress'
                        : isRejected
                        ? 'Verification needs changes'
                        : 'Finish setup to verify'}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Edit your services, experience, and work area"
              onPress={() => navigation.navigate('ProfessionalSetup')}
              style={({pressed}) => [styles.editProfile, pressed && styles.rowPressed]}>
              <MaterialCommunityIcons
                name="account-edit-outline"
                size={19}
                color={ProColors.primary}
              />
              <Text style={styles.editProfileText}>Edit work profile</Text>
              <MaterialCommunityIcons
                name="arrow-right"
                size={19}
                color={ProColors.primary}
              />
            </Pressable>
          </View>
        </MotionReveal>

        {profileFields ? (
          <MotionReveal delay={45}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${readyCount} of ${readiness.length} profile essentials ready`}
              accessibilityHint="Open work details to complete your profile"
              onPress={() => navigation.navigate('ProfessionalSetup')}
              style={({pressed}) => [styles.strength, pressed && styles.rowPressed]}>
              <View style={styles.strengthTop}>
                <WorkVisual kind="portfolio" size={44} />
                <View style={styles.flex}>
                  <Text style={styles.strengthTitle}>Profile essentials</Text>
                  <Text style={styles.strengthMeta}>
                    {readyCount} of {readiness.length} details ready
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={22}
                  color={ProColors.muted}
                />
              </View>
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{min: 0, max: readiness.length, now: readyCount}}
                style={styles.strengthTrack}>
                <View
                  style={[
                    styles.strengthFill,
                    {width: `${(readyCount / readiness.length) * 100}%`},
                  ]}
                />
              </View>
              <Text style={styles.strengthHint}>
                {readyCount < readiness.length
                  ? `Next: add ${readiness.find(item => !item.ready)?.name.toLowerCase()} in work details.`
                  : 'Your key work details are ready. Check verification below.'}
              </Text>
            </Pressable>
          </MotionReveal>
        ) : null}

        {photoError ? (
          <Text accessibilityRole="alert" style={styles.photoError}>
            {photoError}
          </Text>
        ) : null}
        <MotionReveal delay={70}>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Open verification documents and review status"
            disabled={isVerified}
            onPress={() => navigation.navigate('VerificationDocuments')}
            style={({pressed}) => [
              styles.verification,
              pressed && !isVerified && styles.rowPressed,
            ]}>
            <View style={styles.verificationIcon}>
              <MaterialCommunityIcons
                name={
                  isVerified
                    ? 'shield-check-outline'
                    : isUnderReview
                    ? 'clock-check-outline'
                    : 'file-alert-outline'
                }
                size={22}
                color={
                  isVerified
                    ? ProColors.success
                    : isRejected
                    ? ProColors.error
                    : ProColors.primary
                }
              />
            </View>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{verificationTitle}</Text>
              <Text style={styles.rowText}>{verificationText}</Text>
              {!isVerified ? (
                <Text style={styles.verificationAction}>
                  {isUnderReview ? 'View submitted details' : 'Continue verification'}
                  {'  ›'}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </MotionReveal>

        {!isVerified && profileFields ? (
          <View style={styles.lockedNote}>
            <MaterialCommunityIcons name="lock-outline" size={20} color={Colors.navyDeep} />
            <View style={styles.flex}>
              <Text style={styles.lockedTitle}>Jobs, Time & Chat are locked</Text>
              <Text style={styles.lockedText}>
                These unlock as soon as your verification is approved.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue verification"
                onPress={() =>
                  navigation.navigate(
                    isUnderReview || isRejected ? 'VerificationDocuments' : 'ProfessionalSetup',
                  )
                }
                style={styles.lockedAction}>
                <Text style={styles.lockedActionText}>Continue verification →</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {showFullProfile ? (
          <>
        <Text style={styles.groupLabel}>YOUR PROFESSIONAL PROFILE</Text>
        <MotionReveal delay={100}>
          <View style={styles.settingsGroup}>
            <ProfileActionRow
              icon="account-eye-outline"
              title="Public profile"
              description="See what customers can view"
              onPress={() => navigation.navigate('PublicProfilePreview')}
            />
            <ProfileActionRow
              icon="star-circle-outline"
              title="Reviews & reputation"
              description={
                reviewCount
                  ? `${rating == null ? '—' : rating.toFixed(1)} rating · ${reviewCount} client ${reviewCount === 1 ? 'review' : 'reviews'}`
                  : 'Read feedback from your clients'
              }
              onPress={() => navigation.navigate('Reviews')}
            />
            <ProfileActionRow
              icon="qrcode"
              title="My ratings QR"
              description="Clients scan to reach your reviews"
              last
              onPress={() => navigation.navigate('MyQr')}
            />
          </View>
        </MotionReveal>

        <Text style={styles.groupLabel}>PAYMENTS & MEMBERSHIP</Text>
        <MotionReveal delay={108}>
          <View style={styles.settingsGroup}>
            <ProfileActionRow
              icon="cash-multiple"
              title="Commission dues"
              description="Settle your pay-at-home platform share"
              onPress={() => navigation.navigate('Dues')}
            />
            <ProfileActionRow
              icon="crown-outline"
              tone="amber"
              title="Pro membership"
              description="Lower commission, top discovery, member badge"
              onPress={() => navigation.navigate('Membership')}
            />
            <ProfileActionRow
              icon="bank-outline"
              title="Payout account"
              description="Where your earnings land after commission"
              last
              onPress={() => navigation.navigate('Payout')}
            />
          </View>
        </MotionReveal>

        <Text style={styles.groupLabel}>ACCOUNT & NOTIFICATIONS</Text>
        <MotionReveal delay={130}>
          <View style={styles.settingsGroup}>
            <ProfileActionRow
              icon="bell-outline"
              tone="slate"
              title="Notifications"
              description="Requests, messages, and work updates"
              onPress={() => navigation.navigate('Notifications')}
            />
            <ProfileActionRow
              icon="tune-variant"
              tone="slate"
              title="Notification preferences"
              description="Choose the alerts you want to receive"
              onPress={() => navigation.navigate('NotificationSettings')}
            />
            <ProfileActionRow
              icon="lifebuoy"
              tone="slate"
              title="Help & support"
              description="Payments, dues and account issues"
              last
              onPress={() => navigation.navigate('Support')}
            />
          </View>
        </MotionReveal>
          </>
        ) : null}

        <Text style={styles.groupLabel}>DANGER ZONE</Text>
        <View style={styles.deleteCard}>
          <Text style={styles.deleteText}>
            Closing your account signs you out everywhere. Verify with a code and type DELETE to confirm.
          </Text>
          {!codeSent ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send deletion code"
              disabled={sendingCode}
              onPress={sendDeleteCode}
              style={({pressed}) => [styles.sendCodeButton, pressed && {opacity: 0.7}]}>
              <Text style={styles.sendCodeText}>{sendingCode ? 'Sending…' : 'Send verification code'}</Text>
            </Pressable>
          ) : (
            <TextInput
              accessibilityLabel="Deletion verification code"
              style={styles.deleteInput}
              value={deleteCode}
              onChangeText={value => {setDeleteCode(value.replace(/\D/g, '').slice(0, 6)); setDeleteError('');}}
              placeholder="6-digit code"
              placeholderTextColor={ProColors.muted}
              keyboardType="numeric"
              maxLength={6}
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
            />
          )}
          <TextInput
            accessibilityLabel="Type DELETE to confirm"
            style={styles.deleteInput}
            value={deleteConfirm}
            onChangeText={value => {setDeleteConfirm(value); setDeleteError('');}}
            placeholder="Type DELETE"
            placeholderTextColor={ProColors.muted}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {deleteError ? <Text style={styles.deleteError}>{deleteError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
            disabled={!canDelete}
            onPress={deleteAccount}
            style={({pressed}) => [styles.deleteButton, (!canDelete || pressed) && {opacity: 0.6}]}>
            <Text style={styles.deleteButtonText}>{deleting ? 'Deleting…' : 'Delete my account'}</Text>
          </Pressable>
          {deleting ? <ProLoader size={28} tone="red" /> : null}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityHint="Sign out of your professional account"
          disabled={signingOut}
          onPress={signOut}
          style={({pressed}) => [styles.signOut, pressed && styles.rowPressed]}>
          <ProIconChip name="logout-variant" tone="red" size={38} iconSize={20} />
          <Text style={styles.signOutText}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Text>
        </Pressable>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: ProColors.background},
  content: {padding: ProSpacing.lg, paddingBottom: ProSpacing.section, gap: ProSpacing.md},
  identity: {padding: ProSpacing.lg, borderRadius: 20, borderWidth: 1, borderColor: ProColors.border, backgroundColor: ProColors.surface, gap: ProSpacing.lg},
  identityTop: {flexDirection: 'row', alignItems: 'center', gap: ProSpacing.md},
  identityCopy: {flex: 1, minWidth: 0, gap: 4},
  avatar: {width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.navyMid},
  avatarPressed: {opacity: 0.82, transform: [{scale: 0.96}]},
  avatarInitial: {fontSize: 28, lineHeight: 34, fontWeight: '700', color: Colors.white},
  avatarImage: {width: '100%', height: '100%', borderRadius: 36},
  camera: {position: 'absolute', right: -2, bottom: -2, width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: ProColors.accent, borderWidth: 2, borderColor: ProColors.surface},
  photoBusy: {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(17, 31, 53,0.65)'},
  name: {...ProType.section, color: ProColors.text},
  identityMeta: {flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0},
  meta: {...ProType.meta, color: ProColors.secondary, flexShrink: 1},
  editProfile: {minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 13, backgroundColor: ProColors.accent},
  editProfileText: {...ProType.action, color: ProColors.onAccent},
  strength: {padding: ProSpacing.lg, borderRadius: 18, borderWidth: 1, borderColor: ProColors.border, backgroundColor: ProColors.surface},
  strengthTop: {flexDirection: 'row', alignItems: 'center', gap: ProSpacing.md},
  strengthTitle: {...ProType.card, color: ProColors.text},
  strengthMeta: {...ProType.meta, color: ProColors.secondary, marginTop: 2},
  strengthTrack: {height: 7, backgroundColor: ProColors.border, borderRadius: 4, overflow: 'hidden', marginTop: ProSpacing.md},
  strengthFill: {height: 6, backgroundColor: ProColors.primary, borderRadius: 3},
  strengthHint: {...ProType.meta, color: ProColors.secondary, marginTop: 10},
  groupLabel: {...ProType.eyebrow, color: ProColors.secondary, marginTop: ProSpacing.sm, marginBottom: -4},
  settingsGroup: {backgroundColor: ProColors.surface, borderWidth: 1, borderColor: ProColors.border, borderRadius: 18, overflow: 'hidden'},
  actionRow: {minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: ProSpacing.md, paddingHorizontal: ProSpacing.md, paddingVertical: ProSpacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: ProColors.border, backgroundColor: ProColors.surface},
  actionRowLast: {borderBottomWidth: 0},
  actionRowPressed: {opacity: 0.9, transform: [{scale: 0.99}]},
  actionIcon: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  photoError: {
    ...ProType.meta,
    color: ProColors.error,
  },
  flex: {flex: 1, minWidth: 0},
  verification: {flexDirection: 'row', alignItems: 'flex-start', gap: ProSpacing.md, padding: ProSpacing.lg, borderRadius: 18, borderWidth: 1, borderColor: ProColors.border, backgroundColor: ProColors.surface},
  verificationIcon: {width: 42, height: 42, alignItems: 'center', justifyContent: 'center'},
  verificationAction: {...ProType.action, color: ProColors.primary, marginTop: 8},
  lockedNote: {flexDirection: 'row', alignItems: 'flex-start', gap: ProSpacing.md, padding: ProSpacing.lg, borderRadius: 18, borderWidth: 1, borderColor: ProColors.border, backgroundColor: ProColors.surface},
  lockedTitle: {...ProType.card, fontSize: 15, lineHeight: 21, color: ProColors.text},
  lockedText: {...ProType.meta, color: ProColors.secondary, marginTop: 3},
  lockedAction: {minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start'},
  lockedActionText: {...ProType.action, color: ProColors.primary},
  rowPressed: {opacity: 0.82},
  rowTitle: {...ProType.card, fontSize: 15, lineHeight: 21, color: ProColors.text},
  rowText: {...ProType.meta, color: ProColors.secondary, marginTop: 3},
  deleteCard: {backgroundColor: ProColors.surface, borderRadius: 16, padding: ProSpacing.lg, gap: ProSpacing.sm,
    marginHorizontal: ProSpacing.lg, marginBottom: ProSpacing.lg},
  deleteText: {...ProType.body, color: ProColors.secondary},
  deleteInput: {backgroundColor: ProColors.background, borderRadius: 12, paddingHorizontal: ProSpacing.md,
    minHeight: 50, fontSize: 15, color: ProColors.text},
  deleteError: {...ProType.meta, color: ProColors.error},
  deleteButton: {backgroundColor: ProColors.errorSoft, borderRadius: 12, minHeight: 50,
    alignItems: 'center', justifyContent: 'center'},
  deleteButtonText: {...ProType.action, color: ProColors.error},
  sendCodeButton: {backgroundColor: ProColors.accentSoft, borderRadius: 12, minHeight: 50,
    alignItems: 'center', justifyContent: 'center'},
  sendCodeText: {...ProType.action, color: ProColors.primary},
  signOut: {minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: '#F0D2D0', backgroundColor: ProColors.surface},
  signOutText: {...ProType.action, color: ProColors.error},
});
