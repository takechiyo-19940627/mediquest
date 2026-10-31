import { publicationFixture } from '../../fixtures/publication';
import { e2eDatabasePath } from '../../../scripts/e2e-database';
import { confirmVersion } from '../../../server/services/review/service';
import {
  replaceItems,
  publishSet,
} from '../../../server/services/publication/service';

export async function seedStudy() {
  const f = await publicationFixture(3);
  try {
    const third = f.ids[2]!;
    f.c.client
      .prepare(
        'update question_versions set choices_json=?, answer_ids_json=?,reviewed_by=null,reviewed_at=null where id=?',
      )
      .run(
        JSON.stringify(
          ['A', 'B', 'C', 'D'].map((label) => ({
            id: label.toLowerCase(),
            label: `選択肢${label}`,
          })),
        ),
        JSON.stringify(['a', 'b', 'c']),
        third,
      );
    const d = f.detail();
    for (const v of d.candidates)
      confirmVersion(f.c, f.run.setId, v.id, {
        fingerprint: v.fingerprint,
        confirmed: true,
        acknowledgeQuoteMismatch: true,
      });
    replaceItems(f.c, f.run.setId, { expectedRevision: 0, versionIds: f.ids });
    const ready = f.detail();
    publishSet(f.c, f.run.setId, {
      expectedRevision: ready.revision,
      publishFingerprint: ready.publishFingerprint,
      confirmed: true,
    });
    await f.c.client.backup(e2eDatabasePath());
    return { setId: f.run.setId };
  } finally {
    f.close();
  }
}
