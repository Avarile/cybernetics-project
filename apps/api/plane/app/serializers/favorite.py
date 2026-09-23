# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for user favorites (sidebar bookmarks of projects, cycles, modules, views and pages).

``UserFavoriteSerializer`` resolves the favorited entity dynamically based on
``entity_type`` and embeds a lite representation of it as ``entity_data``.
"""

from rest_framework import serializers

from plane.db.models import UserFavorite, Cycle, Module, Issue, IssueView, Page, Project


class ProjectFavoriteLiteSerializer(serializers.ModelSerializer):
    """Minimal project representation for favorites."""

    class Meta:
        model = Project
        fields = ["id", "name", "logo_props"]


class PageFavoriteLiteSerializer(serializers.ModelSerializer):
    """Minimal page representation for favorites, including the (first) linked project id."""

    project_id = serializers.SerializerMethodField()

    class Meta:
        model = Page
        fields = ["id", "name", "logo_props", "project_id"]

    def get_project_id(self, obj):
        """Return the id of the first project the page belongs to, or None."""
        project = obj.projects.first()  # This gets the first project related to the Page
        return project.id if project else None


class CycleFavoriteLiteSerializer(serializers.ModelSerializer):
    """Minimal cycle representation for favorites."""

    class Meta:
        model = Cycle
        fields = ["id", "name", "logo_props", "project_id"]


class ModuleFavoriteLiteSerializer(serializers.ModelSerializer):
    """Minimal module representation for favorites."""

    class Meta:
        model = Module
        fields = ["id", "name", "logo_props", "project_id"]


class ViewFavoriteSerializer(serializers.ModelSerializer):
    """Minimal issue view representation for favorites."""

    class Meta:
        model = IssueView
        fields = ["id", "name", "logo_props", "project_id"]


def get_entity_model_and_serializer(entity_type):
    """Map a favorite ``entity_type`` to ``(model, lite_serializer)``.

    Issues and folders have no embedded serializer; unknown types return ``(None, None)``.
    """
    entity_map = {
        "cycle": (Cycle, CycleFavoriteLiteSerializer),
        "issue": (Issue, None),
        "module": (Module, ModuleFavoriteLiteSerializer),
        "view": (IssueView, ViewFavoriteSerializer),
        "page": (Page, PageFavoriteLiteSerializer),
        "project": (Project, ProjectFavoriteLiteSerializer),
        "folder": (None, None),
    }
    return entity_map.get(entity_type, (None, None))


class UserFavoriteSerializer(serializers.ModelSerializer):
    """User favorite (or favorite folder) with the favorited entity embedded as ``entity_data``."""

    entity_data = serializers.SerializerMethodField()

    class Meta:
        model = UserFavorite
        fields = [
            "id",
            "entity_type",
            "entity_identifier",
            "entity_data",
            "name",
            "is_folder",
            "sequence",
            "parent",
            "workspace_id",
            "project_id",
        ]
        read_only_fields = ["workspace", "created_by", "updated_by"]

    def get_entity_data(self, obj):
        """Load and serialize the favorited entity; None for folders, issues or deleted entities.

        Note: performs one query per favorite.
        """
        entity_type = obj.entity_type
        entity_identifier = obj.entity_identifier

        entity_model, entity_serializer = get_entity_model_and_serializer(entity_type)
        if entity_model and entity_serializer:
            try:
                entity = entity_model.objects.get(pk=entity_identifier)
                return entity_serializer(entity).data
            except entity_model.DoesNotExist:
                return None
        return None
