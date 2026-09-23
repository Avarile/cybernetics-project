# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Free-text issue search used by issue list/search endpoints.
"""

# Python imports
import re

# Django imports
from django.db.models import Q

# Module imports


def search_issues(query, queryset):
    """Filter ``queryset`` to issues matching ``query``.

    Matches name / project identifier by case-insensitive substring and, for
    short queries (<= 20 chars), any standalone numbers as exact sequence IDs.
    """
    fields = ["name", "sequence_id", "project__identifier"]
    q = Q()
    for field in fields:
        if field == "sequence_id" and len(query) <= 20:
            sequences = re.findall(r"\b\d+\b", query)
            for sequence_id in sequences:
                q |= Q(**{"sequence_id": sequence_id})
        else:
            q |= Q(**{f"{field}__icontains": query})
    return queryset.filter(q).distinct()
