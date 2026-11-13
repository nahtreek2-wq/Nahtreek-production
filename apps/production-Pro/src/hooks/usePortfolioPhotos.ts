import {useState} from 'react';
import {confirmDialog} from '../stores/confirm';
import {launchImageLibrary} from 'react-native-image-picker';
import {api} from '../services/apiClient';
import {useProToast} from '../stores/proToast';

// Shared work-photo manager: identical upload/remove rules for profile setup
// (WorkPhotosSection) and the public-profile preview. Presentations stay
// distinct per screen; only the mutation logic is shared.
export function usePortfolioPhotos(refresh: () => Promise<unknown>) {
  const toast = useProToast();
  const [photoTitle, setPhotoTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  async function addWorkPhoto() {
    if (uploading) return;
    if (photoTitle.trim().length < 2) {
      setUploadError('Add a short title for this work first.');
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        includeBase64: true,
        quality: 0.6,
        maxWidth: 1000,
        maxHeight: 1000,
      });
      if (result.didCancel) return;
      const photo = result.assets?.[0];
      if (result.errorCode || !photo?.base64 || !photo.type) {
        throw new Error('Could not open this photo. Please choose another.');
      }
      if (photo.base64.length > 1_333_336) {
        throw new Error('Choose a photo smaller than 1 MB.');
      }
      await api.post('/professionals/me/portfolio', {
        title: photoTitle.trim(),
        mimeType: photo.type,
        contentBase64: photo.base64,
      });
      setPhotoTitle('');
      await refresh();
      toast('Photo added to your public profile.', 'success');
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not upload the photo.');
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(id: string, title: string) {
    void confirmDialog({title: 'Remove work photo?', message: `"${title}" will no longer appear on your public profile.`,
      confirmLabel: 'Remove', cancelLabel: 'Cancel', destructive: true}).then(async ok => {
      if (!ok) return;
      try {
        await api.delete(`/professionals/me/portfolio/${id}`);
        await refresh();
        toast('Photo removed.', 'success');
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : 'Could not remove this photo.');
      }
    });
  }

  return {photoTitle, setPhotoTitle, uploading, uploadError, addWorkPhoto, removePhoto};
}
