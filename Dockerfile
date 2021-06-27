FROM golang AS stage0

WORKDIR /src/go-chat
COPY go-chat/go.sum go-chat/go.mod /src/go-chat/
RUN go mod download

COPY go-chat /src/go-chat

RUN CGO_ENABLED=0 go build -o /bin/chat-server /src/go-chat/server/main.go

FROM alpine
COPY --from=stage0 /bin/chat-server /bin/chat-server

EXPOSE 1234

ENTRYPOINT ["/bin/chat-server"]
