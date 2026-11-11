import {ScreenHeader} from '../components/ScreenHeader';
import {ProLoader} from '../components/ProLoader';
import React, {useMemo, useState} from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {launchImageLibrary} from 'react-native-image-picker';
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
import {PrimaryButton} from '../components/PrimaryButton';
import {useSessionStore} from '../stores/session';
import {useProToast} from '../stores/proToast';
import {ScrollMotionBar, useScrollMotion} from '../components/ScrollMotionBar';

type DocumentType =
  | 'identity-proof'
  | 'address-proof'
  | 'qualification'
  | 'license'
  | 'work-sample';
type VerificationDocument = {
  id: string;
  documentType: DocumentType;
  status: 'UPLOADED' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  uploadedAt: string;
};
type ProfileResponse = {profile: null | {verificationStatus: string}};

const common = [
  {
    type: 'identity-proof' as const,
    title: 'Identity proof',
    help: 'Aadhaar, driving licence or another government photo ID',
  },
  {
    type: 'address-proof' as const,
    title: 'Address proof',
    help: 'A recent document that shows your current address',
  },
];

export function VerificationDocumentsScreen() {
  const scrollMotion = useScrollMotion();
  const navigation =
    useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const queryClient = useQueryClient();
  const toast = useProToast();
  const user = useSessionStore(state => state.user);
  const updateUser = useSessionStore(state => state.updateUser);
  const engineer = Boolean(user?.roles.includes('ENGINEER'));
  const profile = useQuery({
    queryKey: ['professional-profile'],
    queryFn: () => api.get<ProfileResponse>('/professionals/me'),
  });
  const documents = useQuery({
    queryKey: ['verification-documents'],
    queryFn: () =>
      api.get<VerificationDocument[]>(
        '/professionals/me/verification-documents',
      ),
  });
  const [uploading, setUploading] = useState<DocumentType | null>(null);
  const [uploadError, setUploadError] = useState('');
  const required = useMemo(
    () => [
      ...common,
      engineer
        ? {
            type: 'qualification' as const,
            title: 'Qualification proof',
            help: 'Degree or certificate related to your engineering work',
          }
        : {
            type: 'work-sample' as const,
            title: 'Work proof',
            help: 'A clear photo of recent completed work',
          },
    ],
    [engineer],
  );
  const latest = useMemo(() => {
    const result = new Map<DocumentType, VerificationDocument>();
    for (const item of documents.data ?? []) {
      if (!result.has(item.documentType)) {
        result.set(item.documentType, item);
      }
    }
    return result;
  }, [documents.data]);
  const complete = required.every(
    item =>
      latest.has(item.type) && latest.get(item.type)?.status !== 'REJECTED',
  );
  const readyCount = required.filter(
    item => latest.has(item.type) && latest.get(item.type)?.status !== 'REJECTED',
  ).length;
  const verificationStatus =
    profile.data?.profile?.verificationStatus ??
    user?.verificationStatus ??
    'NOT_SUBMITTED';

  const chooseAndUpload = async (documentType: DocumentType) => {
    if (uploading) {
      return;
    }
    setUploadError('');
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      includeBase64: true,
      quality: 0.5,
      maxWidth: 900,
      maxHeight: 900,
    });
    if (result.didCancel) {
      return;
    }
    const asset = result.assets?.[0];
    if (result.errorCode || !asset?.base64 || !asset.type) {
      setUploadError(result.errorMessage || 'Could not read this image.');
      return;
    }
    if (asset.base64.length > 1_450_000) {
      setUploadError('Choose a smaller image under 1 MB.');
      return;
    }
    setUploading(documentType);
    try {
      await api.post('/professionals/me/verification-documents', {
        documentType,
        mimeType: asset.type,
        contentBase64: asset.base64,
      });
      await documents.refetch();
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : 'Could not upload this proof.',
      );
    } finally {
      setUploading(null);
    }
  };

  const submit = useMutation({
    mutationFn: () => {
      if (!complete) {
        throw new ApiError(400, 'Add every required proof before submitting.');
      }
      return api.post('/professionals/me/verification/submit');
    },
    onSuccess: async () => {
      updateUser({verificationStatus: 'UNDER_REVIEW'});
      await Promise.all([
        queryClient.invalidateQueries({queryKey: ['professional-profile']}),
        queryClient.invalidateQueries({queryKey: ['verification-documents']}),
      ]);
      toast('Sent for verification. You will see the decision in this app.', 'success');
      navigation.popToTop();
    },
  });

  if (profile.isPending || documents.isPending) {
    return (
      <View style={styles.center}>
        <ProLoader size={52} label="Loading verification details…" />
      </View>
    );
  }
  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Verify your profile"
        subtitle="Add clear photos of the required proof"
        onBack={() => navigation.goBack()}
      />
      <ScrollMotionBar offset={scrollMotion.offset} reducedMotion={scrollMotion.reducedMotion} />
      <Animated.ScrollView onScroll={scrollMotion.onScroll} scrollEventThrottle={16} contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <View style={styles.introIcon}>
            <MaterialCommunityIcons
              name="shield-check-outline"
              size={28}
              color={Colors.navyDeep}
            />
          </View>
          <View style={styles.flex}>
            <Text style={styles.heading}>Build trust with clients</Text>
            <Text style={styles.help}>
              Only approved professionals are shown in the client app.
            </Text>
          </View>
        </View>
        <Text style={styles.progressText}>
          {readyCount} of {required.length} required proofs ready
        </Text>
        {verificationStatus === 'UNDER_REVIEW' ? (
          <View style={styles.reviewBanner}>
            <MaterialCommunityIcons
              name="clock-outline"
              size={22}
              color={Colors.navyDeep}
            />
            <Text style={styles.reviewText}>
              Your application is under admin review.
            </Text>
          </View>
        ) : null}
        {required.map(item => {
          const uploaded = latest.get(item.type);
          const rejected = uploaded?.status === 'REJECTED';
          return (
            <View key={item.type} style={styles.documentCard}>
              <View
                style={[
                  styles.documentIcon,
                  uploaded && !rejected && styles.documentIconDone,
                ]}>
                <MaterialCommunityIcons
                  name={
                    uploaded && !rejected ? 'check' : 'file-image-plus-outline'
                  }
                  size={24}
                  color={Colors.navyDeep}
                />
              </View>
              <View style={styles.documentCopy}>
                <Text style={styles.documentTitle}>{item.title}</Text>
                <Text style={styles.documentHelp}>
                  {rejected
                    ? uploaded.rejectionReason || 'Please replace this proof.'
                    : uploaded
                    ? uploaded.status === 'APPROVED'
                      ? 'Approved by NAHTREEK'
                      : 'Uploaded and ready for review'
                    : item.help}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={Boolean(uploading) || uploaded?.status === 'APPROVED'}
                onPress={() => chooseAndUpload(item.type)}
                style={styles.uploadButton}>
                {uploading === item.type ? (
                  <ProLoader size={24} />
                ) : (
                  <Text style={styles.uploadText}>
                    {uploaded?.status === 'APPROVED'
                      ? 'Done'
                      : uploaded
                      ? 'Replace'
                      : 'Add'}
                  </Text>
                )}
              </Pressable>
            </View>
          );
        })}
        {uploadError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {uploadError}
          </Text>
        ) : null}
        {submit.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {submit.error instanceof Error
              ? submit.error.message
              : 'Could not send your application.'}
          </Text>
        ) : null}
        <PrimaryButton
          label={
            verificationStatus === 'VERIFIED'
              ? 'Profile verified'
              : verificationStatus === 'UNDER_REVIEW'
              ? 'Application under review'
              : 'Send for verification'
          }
          disabled={
            !complete ||
            verificationStatus === 'UNDER_REVIEW' ||
            verificationStatus === 'VERIFIED'
          }
          loading={submit.isPending}
          onPress={() => submit.mutate()}
          style={styles.submit}
        />
        <Text style={styles.notice}>
          Your documents are private and available only to authorized NAHTREEK
          reviewers.
        </Text>
      </Animated.ScrollView>
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
  flex: {flex: 1, minWidth: 140},
  headerTitle: {...Typography.h2, color: Colors.white},
  headerSubtitle: {...Typography.caption, color: Colors.slate300},
  content: {padding: 20, paddingBottom: Spacing.xxl},
  progressText: {
    ...Typography.body,
    color: Colors.navyDeep,
    fontWeight: '700',
    marginBottom: Spacing.md,
  },
  intro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  introIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {...Typography.h2, color: Colors.slate900},
  help: {...Typography.body, color: Colors.slate600, marginTop: 3},
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: 20,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
  },
  reviewText: {
    flex: 1,
    ...Typography.body,
    color: Colors.navyDeep,
    fontWeight: '600',
  },
  documentCard: {
    minHeight: 100,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.md,
    padding: 20,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.slate200,
    backgroundColor: Colors.white,
  },
  documentIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: Colors.slate100,
  },
  documentIconDone: {backgroundColor: Colors.successBg},
  documentCopy: {flex: 1, minWidth: 0},
  documentTitle: {
    ...Typography.body,
    color: Colors.slate900,
    fontWeight: '700',
  },
  documentHelp: {...Typography.caption, color: Colors.slate600, marginTop: 3},
  uploadButton: {
    minWidth: 68,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.slate100,
  },
  uploadText: {...Typography.button, lineHeight: 22, color: Colors.navyDeep},
  error: {...Typography.body, color: Colors.error, marginTop: Spacing.sm},
  submit: {marginTop: Spacing.lg},
  notice: {
    ...Typography.caption,
    color: Colors.slate500,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
});
