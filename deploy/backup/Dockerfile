FROM alpine:3.21
RUN apk add --no-cache postgresql17-client rclone age tzdata curl bash
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
