from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", include("core.urls")),
    path("api/auth/", include("accounts.urls_auth")),
    path("api/auth/", include("activity.urls_auth")),
    path("api/admin/", include("accounts.urls_admin")),
    path("api/admin/", include("academics.urls_admin")),
    path("api/admin/", include("audit.urls")),
    path("api/admin/", include("documents.urls_manage")),
    path("api/admin/", include("assessments.urls_manage")),
    path("api/admin/", include("assignments.urls_manage")),
    path("api/faculty/", include("academics.urls_faculty")),
    path("api/faculty/", include("documents.urls_manage")),
    path("api/faculty/", include("assessments.urls_manage")),
    path("api/faculty/", include("assignments.urls_manage")),
    path("api/student/", include("academics.urls_student")),
    path("api/student/", include("learning.urls_student")),
    path("api/student/", include("assessments.urls_student")),
    path("api/student/", include("assignments.urls_student")),
    path("api/student/", include("tutor.urls_student")),
    path("api/student/", include("activity.urls_student")),
    path("api/student/", include("analytics.urls_student")),
    path("api/faculty/", include("analytics.urls_manage")),
    path("api/admin/", include("analytics.urls_manage")),
    path("api/admin/", include("analytics.urls_admin")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
]

if settings.DEBUG or settings.SERVE_MEDIA:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

if settings.SERVE_WEB:
    # The Expo web build: real files are served as-is, every other path gets
    # index.html so client-side routes survive a reload. Must be last.
    from core.webapp import webapp

    urlpatterns += [re_path(r"^(?P<path>.*)$", webapp, name="webapp")]
