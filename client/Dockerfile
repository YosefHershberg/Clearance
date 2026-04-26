# syntax=docker/dockerfile:1.7
#
# Thin runtime image. Vite build happens on the GitHub Actions runner —
# this image only serves the pre-built `dist/` directory via nginx.

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
