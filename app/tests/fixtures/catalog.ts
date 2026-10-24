import { publicationFixture } from './publication';
import { confirmVersion } from '../../server/services/review/service';
import {
  replaceItems,
  publishSet,
} from '../../server/services/publication/service';
export const privateMarkers = [
  'SECRET_BODY',
  'SECRET_ANSWER',
  'SECRET_CHOICE',
  'SECRET_EXPLANATION',
  'SECRET_QUOTE',
  'SECRET_SOURCE',
];
export async function catalogFixture() {
  const f = await publicationFixture();
  try {
    f.c.client.exec(
      `update sources set body='SECRET_SOURCE'; update question_versions set body='SECRET_BODY',choices_json='[{"id":"SECRET_ANSWER","label":"SECRET_CHOICE"},{"id":"b","label":"B"}]',answer_ids_json='["SECRET_ANSWER"]',explanation='SECRET_EXPLANATION',quote='SECRET_QUOTE',reviewed_by=null,reviewed_at=null;`,
    );
    for (const v of f.detail().candidates)
      confirmVersion(f.c, f.run.setId, v.id, {
        fingerprint: v.fingerprint,
        confirmed: true,
        acknowledgeQuoteMismatch: true,
      });
    replaceItems(f.c, f.run.setId, {
      expectedRevision: 0,
      versionIds: f.ids.slice(0, 2),
    });
    const d = f.detail();
    publishSet(f.c, f.run.setId, {
      expectedRevision: d.revision,
      publishFingerprint: d.publishFingerprint,
      confirmed: true,
    });
    const draft = await f.generate();
    const archived = await f.generate();
    f.c.client
      .prepare(
        "update question_sets set status='archived',published_by=1,published_at=1 where id=?",
      )
      .run(archived.setId);
    return { ...f, draftId: draft.setId, archivedId: archived.setId };
  } catch (error) {
    f.close();
    throw error;
  }
}
