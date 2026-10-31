import { randomUUID } from 'node:crypto';
import { seedStudy } from './study-db';
import { database } from './catalog-db';
import {
  startSession,
  answerStudyItem,
  skipStudyItem,
} from '../../../server/services/study/service';
import { createRevision } from '../../../server/services/revisions/service';
import {
  getSet,
  updateVersionContent,
  confirmVersion,
} from '../../../server/services/review/service';
import { publishSet } from '../../../server/services/publication/service';

export async function seedHistory(extra = 0) {
  const { setId } = await seedStudy();
  const c = database();
  try {
    const completed = startSession(c, { setId }, randomUUID()).session;
    for (const [index, item] of completed.items.entries())
      answerStudyItem(c, completed.id, item.id, {
        selectedIds:
          index === 0 ? ['b'] : index === 2 ? ['a', 'b', 'c'] : ['a'],
      });
    const interrupted = startSession(c, { setId }, randomUUID()).session;
    skipStudyItem(c, interrupted.id, interrupted.items[0]!.id);
    for (let i = 0; i < extra; i++) startSession(c, { setId }, randomUUID());
    c.client.exec(
      "insert into users(id,display_name,role,created_at) values(2,'Other','learner',1)",
    );
    const other = startSession(c, { setId }, randomUUID()).session;
    c.client
      .prepare('update study_sessions set user_id=2 where id=?')
      .run(other.id);
    return {
      setId,
      completed: completed.id,
      interrupted: interrupted.id,
      other: other.id,
    };
  } finally {
    c.close();
  }
}
export function revise(setId: number) {
  const c = database();
  try {
    const original = getSet(c, setId);
    const revision = createRevision(c, setId, {
      requestKey: randomUUID(),
      expectedRevision: original.revision,
      title: '改訂後のセット',
      description: '',
    });
    const detail = getSet(c, revision.id);
    const first = detail.candidates.find((v) => v.body === '問題1')!;
    const edited = updateVersionContent(c, revision.id, first.id, {
      expectedRevision: detail.revision,
      expectedFingerprint: first.fingerprint,
      body: '改訂後の別問題',
      choices: first.choices,
      answerIds: ['b'],
      explanation: 'NEW_REVISION_EXPLANATION',
      quote: first.quote,
    });
    const fresh = getSet(c, revision.id);
    const candidate = fresh.candidates.find((v) => v.id === edited.id)!;
    confirmVersion(c, revision.id, candidate.id, {
      fingerprint: candidate.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: true,
    });
    const ready = getSet(c, revision.id);
    publishSet(c, revision.id, {
      expectedRevision: ready.revision,
      publishFingerprint: ready.publishFingerprint,
      confirmed: true,
    });
    return revision.id;
  } finally {
    c.close();
  }
}
