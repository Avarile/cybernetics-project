/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Input } from "@plane/ui";

type Props = {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hasError?: boolean;
  disabled?: boolean;
};

export function CyberneticsSecretInput(props: Props) {
  const { id, name, value, onChange, placeholder, hasError = false, disabled = false } = props;
  // states
  const [showSecret, setShowSecret] = useState(false);
  // translation
  const { t } = useTranslation();

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={showSecret ? "text" : "password"}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        hasError={hasError}
        disabled={disabled}
        className="w-full rounded-md pr-10 font-medium"
      />
      <button
        type="button"
        className="absolute top-2.5 right-3 flex items-center justify-center text-placeholder"
        onClick={() => setShowSecret((prev) => !prev)}
        aria-label={
          showSecret
            ? t("project_settings.cybernetics_data.hide_token")
            : t("project_settings.cybernetics_data.show_token")
        }
      >
        {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
