defmodule ThirstrWeb.Router do
  use ThirstrWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
    plug ThirstrWeb.Plugs.ClientVersion
  end

  pipeline :maybe_auth do
    plug ThirstrWeb.Plugs.Auth, optional: true
  end

  pipeline :auth do
    plug ThirstrWeb.Plugs.Auth
  end

  pipeline :auth_limit do
    plug ThirstrWeb.Plugs.RateLimit, bucket: "auth", limit: 60, window: 3600
  end

  pipeline :client_report_limit do
    plug ThirstrWeb.Plugs.RateLimit, bucket: "crep", limit: 120, window: 3600
  end

  pipeline :relay_limit do
    plug ThirstrWeb.Plugs.RateLimit, bucket: "relay", limit: 60, window: 60
  end

  # R-01.7: 5 recovery sign-ins per 10 min per IP
  pipeline :recovery_limit do
    plug ThirstrWeb.Plugs.RateLimit, bucket: "recov", limit: 5, window: 600
  end

  pipeline :device_link_limit do
    plug ThirstrWeb.Plugs.RateLimit, bucket: "dlink", limit: 10, window: 60
  end

  pipeline :share_limit do
    plug ThirstrWeb.Plugs.RateLimit, bucket: "share", limit: 30, window: 60
  end

  pipeline :share_page_limit do
    plug ThirstrWeb.Plugs.RateLimit, bucket: "sharep", limit: 60, window: 60
  end

  pipeline :page do
    plug :accepts, ["html"]

    plug :put_secure_browser_headers, %{
      "content-security-policy" =>
        "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' https: http://localhost:9000; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "referrer-policy" => "no-referrer",
      "x-robots-tag" => "noindex"
    }
  end

  # F-22 (#178): help votes, contact form (signed in or out), screenshot uploads
  pipeline :support_limit do
    plug ThirstrWeb.Plugs.RateLimit, bucket: "supp", limit: 60, window: 3600
  end

  pipeline :email_limit do
    plug ThirstrWeb.Plugs.RateLimit, bucket: "email", limit: 5, window: 3600
  end

  # Admin console (admin-console.md): owner-only, cookie session, CSRF on every form.
  pipeline :admin do
    plug :accepts, ["html", "json"]

    plug Plug.Session,
      store: :cookie,
      key: "_thirstr_admin",
      signing_salt: "adm1n-c0ns0le",
      encryption_salt: "adm1n-c0ns0le-enc",
      same_site: "Strict",
      http_only: true,
      max_age: 8 * 3600

    plug :fetch_session
    plug :protect_from_forgery

    plug :put_secure_browser_headers, %{
      "content-security-policy" =>
        "default-src 'self'; img-src 'self' https: http://localhost:9000; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    }

    plug :admin_enabled
  end

  pipeline :admin_auth do
    plug :admin_required
  end

  defp admin_enabled(conn, opts), do: ThirstrWeb.AdminController.enabled(conn, opts)
  defp admin_required(conn, opts), do: ThirstrWeb.AdminController.require_admin(conn, opts)

  scope "/admin", ThirstrWeb do
    pipe_through :admin
    get "/login", AdminController, :login_page
    post "/login/options", AdminController, :login_options
    post "/login", AdminController, :login

    if Application.compile_env(:thirstr, :dev_routes) do
      get "/dev_login", AdminController, :dev_login
    end
  end

  scope "/admin", ThirstrWeb do
    pipe_through [:admin, :admin_auth]
    post "/logout", AdminController, :logout
    # F-15 R-15.51–53 (#179, #286): one prioritised queue, CSAM cases, legal filings, wellbeing
    get "/", ModController, :queue
    get "/cases", ModController, :cases
    get "/cases/:id", ModController, :case_detail
    post "/cases/:id/decision", ModController, :case_decision
    post "/cases/:id/view", ModController, :case_view
    post "/cases/:id/filings", ModController, :add_filing
    get "/cases/:id/pack", ModController, :pack
    post "/photos/:id/escalate", ModController, :escalate_photo
    post "/reveal", ModController, :reveal
    get "/pause", ModController, :pause
    get "/me", ModController, :my_day
    get "/reports/:id", AdminController, :report
    post "/reports/:id/action", AdminController, :report_action
    get "/photos", AdminController, :photos
    post "/photos/:id", AdminController, :photo_decision
    post "/moments/:id", AdminController, :moment_decision
    get "/linked", AdminController, :linked
    post "/linked/:id", AdminController, :linked_decision
    get "/quarantine", AdminController, :quarantine
    post "/accounts/:id/action", AdminController, :account_action
    get "/appeals", AdminController, :appeals
    post "/appeals/:id", AdminController, :appeal_decision
    # A-12 support inbox (F-22, #178)
    get "/support", AdminSupportController, :index
    get "/support/macros", AdminSupportController, :macros
    post "/support/macros", AdminSupportController, :put_macro
    post "/support/macros/:id/delete", AdminSupportController, :delete_macro
    get "/support/feedback", AdminSupportController, :feedback
    post "/support/feedback/:id", AdminSupportController, :feedback_action
    get "/support/:id", AdminSupportController, :show
    post "/support/:id/reply", AdminSupportController, :reply
    post "/support/:id/status", AdminSupportController, :status
    get "/audit", AdminController, :audit_log
    get "/delivery", AdminController, :delivery
    get "/places", AdminController, :places
    post "/places/import", AdminController, :places_import
    post "/places/venues/:id/:action", AdminController, :venue_hidden
    post "/places/events", AdminController, :add_event
    post "/places/events/:id/remove", AdminController, :remove_event
    # A-11 Costs & capacity (EN-21, #180)
    get "/costs", AdminCostsController, :index
    post "/costs/items", AdminCostsController, :add_item
    post "/costs/items/:id", AdminCostsController, :item_action
    post "/costs/settings", AdminCostsController, :save_settings
  end

  # iOS passkeys / universal links (I-03). Apple fetches this without auth.
  # I-02 public profile share page (no scripts)
  scope "/p", ThirstrWeb do
    pipe_through [:share_page_limit, :page]
    get "/:slug", SharePageController, :page
  end

  scope "/.well-known", ThirstrWeb do
    get "/apple-app-site-association", WellKnownController, :aasa
  end

  scope "/v1", ThirstrWeb do
    pipe_through :api

    get "/health", PublicController, :health
    get "/config", PublicController, :config
    get "/welcome", PublicController, :welcome
    get "/cities", PublicController, :cities
    get "/safe-mode/countries", PublicController, :safe_mode_countries

    # Map tiles proxied so the upstream never sees users (beta-build-plan.md)
    get "/tiles/style.json", TileController, :style
    get "/tiles/v/:z/:x/:y", TileController, :tile
    get "/tiles/fonts/:stack/:range", TileController, :font

    scope "/auth" do
      pipe_through [:auth_limit, :maybe_auth]
      post "/passkey/register/options", AuthController, :passkey_register_options
      post "/passkey/register", AuthController, :passkey_register
      post "/passkey/login/options", AuthController, :passkey_login_options
      post "/passkey/login", AuthController, :passkey_login
      post "/oidc", AuthController, :oidc
      post "/recovery/options", AuthController, :recovery_options
      post "/email/verify", AuthController, :email_verify
      post "/refresh", AuthController, :refresh
    end

    # EN-05 (#164): crash reports + session pings, per-IP limited, no account
    scope "/client" do
      pipe_through [:client_report_limit]
      post "/errors", ClientController, :error
      post "/sessions", ClientController, :session
    end

    scope "/auth" do
      pipe_through [:recovery_limit, :maybe_auth]
      post "/recovery", AuthController, :recovery
    end

    scope "/auth" do
      pipe_through [:email_limit]
      post "/email/link", AuthController, :email_link
    end

    # F-22 (#178): help center votes + contact form also work signed out (S-84 → Contact)
    scope "/" do
      pipe_through [:support_limit, :maybe_auth]
      post "/help/votes", SupportController, :vote
      post "/support/requests", SupportController, :create
      post "/support/uploads", SupportController, :upload
    end

    scope "/" do
      pipe_through [:auth, :support_limit]
      get "/support/requests", SupportController, :index
      get "/support/requests/:id", SupportController, :show
      post "/support/requests/:id/messages", SupportController, :message
      post "/support/requests/:id/solve", SupportController, :solve
      post "/feedback", SupportController, :feedback
      # R-22.22 account recovery claims (no admin path, R-22.20)
      post "/auth/recovery/claim", SupportController, :claim_start
      get "/auth/recovery/claim", SupportController, :claim_current
      get "/auth/recovery/claim/:id", SupportController, :claim_show
      post "/auth/recovery/claim/:id/challenge", SupportController, :claim_challenge
      post "/auth/recovery/claim/:id/selfie", SupportController, :claim_selfie
      post "/auth/recovery/claim/:id/cancel", SupportController, :claim_cancel
      delete "/auth/recovery/claim/:id", SupportController, :claim_withdraw
      post "/auth/recovery/claim/:id/complete", SupportController, :claim_complete
    end

    scope "/" do
      pipe_through [:auth, :email_limit]
      post "/me/email", AccountController, :add_email
    end

    scope "/" do
      pipe_through :auth
      post "/auth/logout", AuthController, :logout
      post "/auth/logout_all", AuthController, :logout_all

      get "/me", AccountController, :me
      delete "/account", AccountController, :delete
      post "/account/pause", AccountController, :pause
      post "/account/resume", AccountController, :resume

      put "/me/basics", AccountController, :basics
      post "/me/onboarding/photo_later", AccountController, :photo_later
      post "/me/onboarding/verify_later", AccountController, :verify_later

      # F-06 profiles
      get "/profile-options", ProfileController, :options
      get "/me/profiles", ProfileController, :index
      patch "/me/profiles/:id", ProfileController, :update
      post "/me/profiles/:profile_id/photos", ProfileController, :create_photo
      post "/me/profiles/:profile_id/photos/:photo_id/check", ProfileController, :check_photo
      delete "/me/profiles/:profile_id/photos/:photo_id", ProfileController, :delete_photo
      put "/me/profiles/:profile_id/photos/order", ProfileController, :order_photos
      get "/profiles/:id", ProfileController, :show
      post "/profiles/:id/tap", ProfileController, :tap
      post "/profiles/:id/block", ProfileController, :block
      post "/profiles/:id/hide", ProfileController, :hide
      delete "/profiles/:id/hide", ProfileController, :unhide
      get "/me/hidden", ProfileController, :hidden
      get "/me/blocks", ProfileController, :blocks
      delete "/me/blocks/:id", ProfileController, :unblock
      get "/taps", ProfileController, :taps
      post "/taps/seen", ProfileController, :taps_seen

      # F-05 location & visibility
      put "/me/location", ExploreController, :location
      put "/me/pin", ExploreController, :pin
      delete "/me/pin", ExploreController, :unpin
      patch "/me/visibility", ExploreController, :visibility

      # F-04 explore
      get "/explore/grid", ExploreController, :grid
      get "/explore/map", ExploreController, :map
      get "/explore/tray", ExploreController, :tray
      get "/explore/summary", ExploreController, :summary
      get "/explore/visitors", ExploreController, :visitors

      # F-20 travel plans (#188)
      get "/trips", TripController, :index
      post "/trips", TripController, :create
      patch "/trips/:id", TripController, :update
      delete "/trips/:id", TripController, :delete
      # F-21 Moments (#212)
      post "/moments/uploads", MomentController, :upload
      post "/moments/:id/publish", MomentController, :publish
      get "/moments/mine", MomentController, :mine
      post "/moments/views", MomentController, :views
      post "/moments/:id/tap", MomentController, :tap
      post "/moments/:id/screenshot", MomentController, :screenshot
      delete "/moments/:id", MomentController, :delete
      put "/moments/mutes/:profile_id", MomentController, :mute
      delete "/moments/mutes/:profile_id", MomentController, :unmute
      get "/profiles/:id/moments", MomentController, :for_profile

      # F-09 Now
      put "/me/now", ExploreController, :set_now
      delete "/me/now", ExploreController, :end_now

      # F-17 / F-14
      get "/me/settings", ExploreController, :settings
      patch "/me/settings", ExploreController, :update_settings
      put "/me/safe_mode", ExploreController, :safe_mode

      # Messaging (F-07, F-08, F-16): MLS delivery service, E2EE blobs, push token
      post "/mls/keypackages", ChatController, :upload_key_packages
      get "/mls/keypackages", ChatController, :key_package_counts
      post "/mls/keypackages/claim", ChatController, :claim_key_packages
      post "/mls/messages", ChatController, :send_messages
      get "/mls/messages", ChatController, :pull
      post "/mls/messages/ack", ChatController, :ack
      post "/media/upload", ChatController, :create_blob
      get "/media/:id", ChatController, :blob
      delete "/media/:id", ChatController, :delete_blob
      put "/me/push", ChatController, :push_token

      # B3: Tonight, parties, activities & clubs, venues
      get "/tonight", SceneController, :tonight
      post "/tonight", SceneController, :create_plan
      delete "/tonight/:id", SceneController, :delete_plan
      get "/parties", SceneController, :parties
      post "/parties", SceneController, :create_party
      get "/parties/:id", SceneController, :party
      patch "/parties/:id", SceneController, :update_party
      post "/parties/:id/request", SceneController, :request_party
      post "/parties/:id/leave", SceneController, :leave_party
      post "/parties/:id/rate", SceneController, :rate_party
      post "/parties/:id/report", SceneController, :report_party
      post "/parties/:id/requests/:profile_id/:action", SceneController, :party_request_action
      get "/activities", SceneController, :activities
      post "/activities", SceneController, :create_activity
      delete "/activities/:id", SceneController, :delete_activity
      post "/activities/:id/rsvp", SceneController, :rsvp
      get "/activities/:id/members", SceneController, :activity_members
      delete "/activities/:id/members/:profile_id", SceneController, :remove_member
      get "/clubs", SceneController, :clubs
      post "/clubs", SceneController, :create_club
      get "/clubs/:id", SceneController, :club
      post "/clubs/:id/join", SceneController, :join_club
      post "/clubs/:id/leave", SceneController, :leave_club
      post "/clubs/:id/members/:profile_id/:action", SceneController, :club_admin
      get "/venues/nearby", SceneController, :venues
      get "/places", SceneController, :places
      post "/venues", SceneController, :create_venue
      delete "/venues/:id", SceneController, :remove_venue
      post "/venues/:id/checkin", SceneController, :checkin
      patch "/venues/:id/checkin", SceneController, :update_checkin
      post "/venues/checkout", SceneController, :checkout
      get "/venues/:id/here", SceneController, :here

      # B4a: reports (F-15), notices & appeals (R-AD.9), vouches (F-18)
      post "/verification/challenge", TrustController, :verify_challenge
      post "/verification/attest", TrustController, :verify_issue
      post "/verification/redeem", TrustController, :verify_redeem
      post "/reports", TrustController, :report
      get "/me/notices", TrustController, :notices
      post "/me/notices/seen", TrustController, :notices_seen
      post "/me/notices/:id/appeal", TrustController, :appeal
      post "/profiles/:id/vouch", TrustController, :vouch
      delete "/profiles/:id/vouch", TrustController, :unvouch

      # B4c: safety (F-13)
      post "/trusted/invite", SafetyController, :invite
      get "/trusted", SafetyController, :contacts
      delete "/trusted/:id", SafetyController, :remove
      get "/checkin", SafetyController, :current
      post "/checkin", SafetyController, :start
      delete "/checkin", SafetyController, :cancel
      post "/checkin/panic", SafetyController, :panic
      put "/checkin/:token/alerts", SafetyController, :refresh
      post "/checkin/:token/extend", SafetyController, :extend
      post "/checkin/:token/ok", SafetyController, :ok
      post "/checkin/:token/panic", SafetyController, :panic_checkin

      # B4d: data export, devices, linked accounts, share links
      get "/account/export", AccountDataController, :export
      get "/me/devices", AccountDataController, :devices
      delete "/me/devices/:id", AccountDataController, :remove_device
      post "/devices/link", AccountDataController, :link_start
      # R-01.7 recovery phrase + sealed backup (#25)
      get "/me/recovery", AccountDataController, :recovery_status
      put "/me/recovery", AccountDataController, :recovery_put
      delete "/me/recovery", AccountDataController, :recovery_delete
      get "/me/recovery/vault", AccountDataController, :vault_get
      put "/me/recovery/vault", AccountDataController, :vault_put
      # R-01.15 opt-in chat backup (#146)
      get "/me/backup", AccountDataController, :backup_status
      post "/me/backup/segments", AccountDataController, :backup_segment
      get "/me/backup/manifest", AccountDataController, :backup_get
      put "/me/backup/manifest", AccountDataController, :backup_commit
      delete "/me/backup", AccountDataController, :backup_delete
      # #25 device attestation (iOS App Attest)
      get "/devices/attest", AccountDataController, :attest_status
      post "/devices/attest/challenge", AccountDataController, :attest_challenge
      post "/devices/attest", AccountDataController, :attest
      post "/devices/assert", AccountDataController, :assert
      get "/devices/link/:code", AccountDataController, :link_status
      post "/devices/link/:code/confirm", AccountDataController, :link_confirm
      # R-01.14 history transfer to a new phone (#146)
      post "/devices/transfer", AccountDataController, :xfer_create
      get "/devices/transfer/incoming", AccountDataController, :xfer_incoming
      get "/devices/transfer/:id", AccountDataController, :xfer_get
      delete "/devices/transfer/:id", AccountDataController, :xfer_cancel
      post "/devices/transfer/:id/chunks", AccountDataController, :xfer_chunk
      post "/devices/transfer/:id/chunks/:n/ready", AccountDataController, :xfer_ready
      post "/devices/transfer/:id/ack", AccountDataController, :xfer_ack
      post "/devices/transfer/:id/done", AccountDataController, :xfer_finish
      get "/me/profiles/:id/linked-accounts", AccountDataController, :linked
      post "/me/linked-accounts", AccountDataController, :link_account
      patch "/me/linked-accounts/:id", AccountDataController, :update_linked
      post "/me/linked-accounts/:id/verify", AccountDataController, :verify_linked
      delete "/me/linked-accounts/:id", AccountDataController, :remove_linked
      get "/me/profiles/:id/share", AccountDataController, :get_share
      post "/me/profiles/:id/share", AccountDataController, :share
      patch "/me/profiles/:id/share", AccountDataController, :update_share
      put "/me/profiles/:id/share/preview", AccountDataController, :share_preview
      delete "/me/profiles/:id/share", AccountDataController, :unshare
    end

    # I-02 R-I02.4c: in-app open of a share link, 30/min per IP
    scope "/" do
      pipe_through [:share_limit, :auth]
      get "/share/:slug", AccountDataController, :resolve
    end

    # testing.md › Chat test bot (staging only): the bot service gets its session here.
    scope "/testbot" do
      pipe_through :auth_limit
      post "/session", TestBotController, :session
    end

    scope "/auth" do
      pipe_through :device_link_limit
      post "/device-link", AccountDataController, :link_claim
    end

    # Trusted-contact web page (no account; rid from the link fragment)
    scope "/relay" do
      pipe_through :relay_limit
      get "/:rid", SafetyController, :relay
      post "/:rid/accept", SafetyController, :accept
      put "/:rid/push", SafetyController, :push
      get "/:rid/messages", SafetyController, :messages
      post "/:rid/ack", SafetyController, :ack
      delete "/:rid", SafetyController, :opt_out
    end
  end

  if Application.compile_env(:thirstr, :dev_routes) do
    scope "/v1/dev", ThirstrWeb do
      pipe_through :api
      post "/oidc/token", DevController, :oidc_token
    end
  end
end
