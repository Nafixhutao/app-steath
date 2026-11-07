FROM busybox:1.36
WORKDIR /www
COPY index.html /www/index.html
EXPOSE 3000
CMD ["httpd", "-f", "-p", "3000"]
