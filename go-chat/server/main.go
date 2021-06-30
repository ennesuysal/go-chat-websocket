package main

import (
	"com.enesuysal/go-chat/api"
	"com.enesuysal/go-chat/api/ent"
	"context"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"github.com/rsms/gotalk"
	"log"
	"net/http"
	"sync"
)

type User struct {
	Name string `json:"name"`
	Surname string `json:"surname"`
	Username string `json:"username"`
}

type Token struct {
	Tkn string `json:"token"`
}

type Msg struct {
	Text string `json:"text"`
	Tkn string `json:"token"`
	Receiver string `json:"rcv"`
	Sender string `json:"sender"`
}

type MsgSender struct {
	Text string `json:"text"`
	Sender string `json:"sender"`
}

type OnLines struct {
	Users []User `json:"users"`
}

var (
	socks   map[*gotalk.WebSocket]int
	socksmu sync.RWMutex
	db = api.OpenDb()
)

func onConnect(s *gotalk.WebSocket) {
	socksmu.Lock()
	defer socksmu.Unlock()
	socks[s] = 1

	s.CloseHandler = func(s *gotalk.WebSocket, _ int) {
		fmt.Printf("Peer %s diconnected\n", s)

		if s.UserData != nil {
			u, _ := api.QueryUserbyToken(context.Background(), s.UserData.(string), db)
			_, err := u.Update().SetIsOnline(0).Save(context.Background())
			if err != nil {
				log.Printf("SetIsOnline(0) failed.\n")
			} else {
				broadcast("hasLeft", u.Username, s.UserData.(string))
			}
		}

		socksmu.Lock()
		defer socksmu.Unlock()
		delete(socks, s)
	}

	s.UserData = nil

	fmt.Printf("Peer %s connected on %s\n", s, s.Conn().LocalAddr())
}

func broadcast(name string, in interface{}, token string) {
	socksmu.RLock()
	defer socksmu.RUnlock()
	for s := range socks {
		if s.UserData != token {
			err := s.Notify(name, in)
			if err != nil {
				log.Printf("Notify: %s failed.\n", name)
			}
		}
	}
}

func server() {
	socks = make(map[*gotalk.WebSocket]int)
	defer func(){
		err := db.Close()
		if err != nil {
			log.Println("db.Close() failed.")
		}
	}()

	gotalk.Handle("sendMsg", func(in Msg) error{
		u, err := api.QueryUserbyToken(context.Background(), in.Tkn, db)
		message := new(ent.Message)
		if err != nil || u == nil {
			return err
		}
		message, err = api.CreateMessage(context.Background(), db, u.Username, in.Receiver, in.Text)
		if err != nil {
			log.Println("CreateMessage failed.")
			return nil
		}
		in.Sender = u.Username
		socksmu.RLock()
		defer socksmu.RUnlock()
		for s := range socks {
			if s.UserData == nil {
				return nil
			}
			u2, err := api.QueryUserbyToken(context.Background(), s.UserData.(string), db)
			if u2 == nil || err != nil {
				return err
			}

			if u2.Username == in.Receiver {
				err := s.Notify("newMsg", in)
				if err == nil {
					log.Printf("Message sended.\n")
				} else {
					log.Printf("Message sending failed.\n")
				}
			}
		}
		_, err = message.Update().SetSeen(1).Save(context.Background())
		if err != nil {
			log.Printf("SetSeen(1) failed.\n")
		}
		return nil
	})

	gotalk.Handle("login", func(s *gotalk.Sock, in User) (*Token, error) {
		user, err := api.QueryUser(context.Background(), in.Username, db)
		if user == nil || err != nil {
			log.Println("Kullanıcı bulunamadı, oluşturuluyor...")
			user, err = api.CreateUser(context.Background(), in.Username, in.Name, in.Surname, db)
			if err != nil {
				return nil, err
			}
		}

		t := md5.Sum([]byte(in.Username))
		token := Token{Tkn: hex.EncodeToString(t[:])}
		_, err = user.Update().SetToken(token.Tkn).SetIsOnline(1).Save(context.Background())
		if err != nil {
			log.Printf("Inserting user token to db failed.\n")
		}
		s.UserData = token.Tkn
		broadcast("isOnline", user.Username, s.UserData.(string))

		return &token, nil
	})

	gotalk.Handle("online", func(t Token) (*OnLines, error) {
		o, err := api.QueryOnlineUsers(context.Background(), db)
		if err != nil {
			return nil, err
		}
		users := make([]User, 0)
		current, _ := api.QueryUserbyToken(context.Background(), t.Tkn, db)

		for _, x := range o {
			if current.Username != x.Username {
				users = append(users, User{
					Name:     x.Name,
					Surname:  x.Surname,
					Username: x.Username,
				})
			}
		}

		return &OnLines{Users: users}, nil
	})

	gotalk.Handle("getMsgs", func(token Token)([]MsgSender, error) {
		u, err := api.QueryUserbyToken(context.Background(), token.Tkn, db)
		if err != nil {
			return nil, err
		}
		msgs, _ := api.QueryLastMessages(context.Background(), u)
		result := make([]MsgSender, 0)
		var tmp MsgSender
		for _, msg := range msgs {
			tmp = MsgSender{
				Text:   msg.Message,
				Sender: msg.SenderUsername,
			}
			result = append(result, tmp)
		}

		return result, nil
	})

	// Serve gotalk at "/gotalk/"
	gh := gotalk.WebSocketHandler()
	gh.OnConnect = onConnect
	routes := &http.ServeMux{}
	server := &http.Server{Addr: "0.0.0.0:1234", Handler: routes}
	routes.Handle("/gotalk/", gh)

	// Start server
	fmt.Printf("Listening on ws://%s/\n", server.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		panic(err)
	}
}

func main() {
	server()
}