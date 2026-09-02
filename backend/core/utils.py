from django.shortcuts import get_object_or_404 as _get_object_or_404

from .exceptions import NotFound


def get_or_404(queryset, **kwargs):
    """Scoped lookup: a record outside the caller's scope is indistinguishable
    from one that does not exist, which avoids leaking existence."""
    try:
        return queryset.get(**kwargs)
    except (queryset.model.DoesNotExist, ValueError, TypeError):
        raise NotFound(f"{queryset.model.__name__} not found.")


def client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")
