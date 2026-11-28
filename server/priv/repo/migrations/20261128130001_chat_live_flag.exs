defmodule Thirstr.Repo.Migrations.ChatLiveFlag do
  use Ecto.Migration

  # EN-23 OB-1 (#343): recipient device had a live envelope socket when the message was stored,
  # so delivery time can be split online / offline. Expand-only.
  def change do
    alter table(:mls_messages) do
      add :live, :boolean, null: false, default: false
    end
  end
end
