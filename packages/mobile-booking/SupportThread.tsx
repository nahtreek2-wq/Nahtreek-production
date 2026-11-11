import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {BorderRadius, Colors, Spacing, Typography} from '@nahtreek/design-system';

export type SupportReplyView = {
  id: string;
  authorRole: 'USER' | 'ADMIN';
  message: string;
  createdAt: string;
};

// Shared support thread: the same conversation read on both apps and the
// admin desk. USER rows align right (the reader's own words), ADMIN rows
// align left with the support tint. Nothing here mutates — the host screen
// owns the reply box, its own query keys and its own toasts.
export function SupportThread({replies}: {replies: SupportReplyView[]}) {
  if (!replies.length) return null;
  return (
    <View style={styles.thread} accessibilityLabel={`Conversation, ${replies.length} ${replies.length === 1 ? 'message' : 'messages'}`}>
      {replies.map(reply => {
        const mine = reply.authorRole === 'USER';
        return (
          <View key={reply.id} style={[styles.row, mine && styles.rowMine]}>
            <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
              <Text style={styles.author}>{mine ? 'You' : 'Support'}</Text>
              <Text style={[styles.message, mine ? styles.messageMine : styles.messageTheirs]}>
                {reply.message}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  thread: {gap: Spacing.sm},
  row: {flexDirection: 'row', justifyContent: 'flex-start'},
  rowMine: {justifyContent: 'flex-end'},
  bubble: {maxWidth: '88%', borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 2},
  bubbleMine: {backgroundColor: Colors.navyDeep},
  bubbleTheirs: {backgroundColor: Colors.slate100},
  author: {...Typography.badge, color: Colors.slate500, fontWeight: '700'},
  message: {...Typography.body, lineHeight: 21},
  messageMine: {color: Colors.white},
  messageTheirs: {color: Colors.slate900},
});
