export default defineNuxtRouteMiddleware((to) => {
  if (/^\/admin\/(sources|sets|manual-sets)(\/|$)/.test(to.path))
    return navigateTo('/admin/past-exams', { replace: true });
});
