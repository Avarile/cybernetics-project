/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Input } from "@plane/ui";

type Props = {
  isSaving: boolean;
  onDiscard: () => void;
  onSave: (changeNote: string) => Promise<void>;
};

/** Sticky footer shown while there are unsaved edits; definition changes create a new version. */
export function AgentSaveBar({ isSaving, onDiscard, onSave }: Props) {
  const { t } = useTranslation();
  const [changeNote, setChangeNote] = useState("");
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-subtle bg-layer-1 px-6 py-3">
      <p className="text-13 font-medium text-primary">{t("agents.save.unsaved")}</p>
      <Input
        value={changeNote}
        maxLength={500}
        onChange={(e) => setChangeNote(e.target.value)}
        placeholder={t("agents.save.change_note_placeholder")}
        className="min-w-48 flex-1"
      />
      <div className="flex gap-2">
        <Button variant="secondary" size="lg" onClick={onDiscard} disabled={isSaving}>
          {t("agents.save.discard")}
        </Button>
        <Button
          variant="primary"
          size="lg"
          loading={isSaving}
          onClick={() => onSave(changeNote).then(() => setChangeNote(""))}
        >
          {t("agents.save.save")}
        </Button>
      </div>
    </div>
  );
}
