FROM --platform=linux/amd64 eclipse-temurin:17-jre-jammy
WORKDIR /opt/intsmart
EXPOSE 8445 48446
CMD ["/bin/bash", "-lc", "sleep 10 && chmod +x /opt/intsmart/bin/jsvc /opt/intsmart/bin/integration.sh && exec /opt/intsmart/bin/integration.sh --java-home /opt/java/openjdk --app-home /opt/intsmart --app-user root run"]
