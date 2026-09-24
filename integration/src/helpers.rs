//! Common helper functions for scripts and tests

use std::{path::Path, sync::Arc};

use anyhow::{Context, Result, anyhow, bail};
use miden_client::{
    Client, Felt, Word,
    account::{
        Account, AccountBuilder, AccountComponent, AccountType, StorageSlotName,
        component::{BasicWallet, InitStorageData, NoAuth},
    },
    auth::{AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    keystore::{FilesystemKeyStore, Keystore},
    rpc::{Endpoint, GrpcClient},
    utils::Deserializable,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use miden_mast_package::Package;
use rand::Rng;

/// Test setup configuration containing initialized client and keystore
pub struct ClientSetup {
    /// The configured Miden client instance.
    pub client: Client<FilesystemKeyStore>,
    /// The filesystem-backed keystore used by the client.
    pub keystore: Arc<FilesystemKeyStore>,
}

/// Initializes test infrastructure with client and keystore
///
/// # Returns
/// A `ClientSetup` containing the initialized client and keystore
///
/// # Errors
/// Returns an error if RPC connection fails, keystore initialization fails,
/// or client building fails
pub async fn setup_client() -> Result<ClientSetup> {
    // Initialize RPC connection
    let endpoint = Endpoint::testnet();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(GrpcClient::new(&endpoint, timeout_ms));

    // Initialize keystore
    let keystore_path = std::path::PathBuf::from("../keystore");

    let keystore =
        Arc::new(FilesystemKeyStore::new(keystore_path).context("Failed to initialize keystore")?);

    let store_path = std::path::PathBuf::from("../store.sqlite3");

    let client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(store_path)
        .authenticator(keystore.clone())
        .build()
        .await
        .context("Failed to build Miden client")?;

    Ok(ClientSetup { client, keystore })
}

/// Builds a Miden project in the specified directory
///
/// # Arguments
/// * `dir` - Path to the directory containing the Cargo.toml
/// * `release` - Whether to build in release mode
///
/// # Returns
/// The compiled `Package`
///
/// # Errors
/// Returns an error if compilation fails or if the output is not in the expected format
pub fn build_project_in_dir(dir: &Path, release: bool) -> Result<Package> {
    let profile = if release { "--release" } else { "--debug" };
    let profile_name = if release { "release" } else { "debug" };
    let manifest_path = dir.join("Cargo.toml");
    let artifact_path = dir.join("target").join("miden").join(profile_name).join("out.masp");

    let args = vec![
        profile.to_string(),
        "-o".to_string(),
        artifact_path.display().to_string(),
        "--manifest-path".to_string(),
        manifest_path.display().to_string(),
    ];

    let status = miden_build(args).context("Failed to compile project")?;

    if !status.success() {
        bail!("Failed to compile project package. See output for details.");
    }

    let package_bytes = std::fs::read(&artifact_path)
        .context(format!("Failed to read compiled package from {}", artifact_path.display()))?;

    Package::read_from_bytes(&package_bytes).context("Failed to deserialize package from bytes")
}

/// Configuration for creating an account with a custom component
pub struct AccountCreationConfig {
    /// The account type to create. The account type also encodes the
    /// storage visibility (`AccountType::Public` / `AccountType::Private`).
    pub account_type: AccountType,
    /// Initial component storage data keyed by storage slot schema.
    pub init_storage_data: InitStorageData,
}

impl Default for AccountCreationConfig {
    fn default() -> Self {
        Self {
            account_type: AccountType::Public,
            init_storage_data: InitStorageData::default(),
        }
    }
}

/// Creates an account with a custom component from a compiled package
///
/// # Arguments
/// * `client` - The Miden client instance
/// * `package` - The compiled package containing the account component
/// * `config` - Configuration for account creation
///
/// # Returns
/// The created `Account`
///
/// # Errors
/// Returns an error if account creation or client operations fail
pub async fn create_account_from_package(
    client: &mut Client<FilesystemKeyStore>,
    package: Arc<Package>,
    config: AccountCreationConfig,
) -> Result<Account> {
    let account_component =
        AccountComponent::from_package(package.as_ref(), &config.init_storage_data)
            .context("Failed to create account component from package")?;

    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let account = AccountBuilder::new(init_seed)
        .account_type(config.account_type)
        .with_component(account_component)
        .with_component(NoAuth)
        .build()
        .context("Failed to build account")?;

    println!("Account ID: {:?}", account.id());

    client
        .add_account(&account, false)
        .await
        .context("Failed to add account to client")?;

    Ok(account)
}

/// Creates a basic wallet account with authentication
///
/// # Arguments
/// * `client` - The Miden client instance
/// * `keystore` - The keystore for storing authentication keys
/// * `config` - Configuration for account creation
///
/// # Returns
/// The created `Account` with basic wallet functionality
///
/// # Errors
/// Returns an error if account creation, key generation, or keystore operations fail
pub async fn create_basic_wallet_account(
    client: &mut Client<FilesystemKeyStore>,
    keystore: Arc<FilesystemKeyStore>,
    config: AccountCreationConfig,
) -> Result<Account> {
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

    let builder = AccountBuilder::new(init_seed)
        .account_type(config.account_type)
        .with_component(AuthSingleSig::from_public_key(key_pair.public_key()))
        .with_component(BasicWallet);

    let account = builder.build().context("Failed to build basic wallet account")?;

    client
        .add_account(&account, false)
        .await
        .context("Failed to add account to client")?;

    keystore
        .add_key(&key_pair, account.id())
        .await
        .context("Failed to add key to keystore")?;

    Ok(account)
}

fn miden_build(args: impl IntoIterator<Item = String>) -> anyhow::Result<std::process::ExitStatus> {
    let mut cmd = match std::env::var_os("MIDENUP_HOME") {
        Some(_) => std::process::Command::new("miden"),
        None => match std::env::var_os("CARGO_MIDEN") {
            Some(cargo_miden) => {
                // The `cargo-miden` binary expects the `miden` subcommand token,
                // the same as when cargo invokes it as `cargo miden`.
                let mut cmd = std::process::Command::new(cargo_miden);
                cmd.arg("miden");
                cmd
            }
            None => {
                let mut cmd = std::process::Command::new("cargo");
                cmd.arg("miden");
                cmd
            }
        },
    };
    cmd.arg("build").args(args);

    let mut child = cmd.spawn().map_err(|err| anyhow!("Failed to spawn build command: {err}"))?;

    child.wait().map_err(|err| anyhow!("Build command failed: {err}"))
}

/// Returns the MAST root of the exported procedure called `name` (e.g. `get-entry`) in `package`.
/// Compiler packages export paths like `::"miden:oracle/oracle@0.1.0"::"get-entry"`.
pub fn procedure_root(package: &Package, name: &str) -> Result<Word> {
    package
        .manifest
        .exports()
        .filter_map(|export| export.as_procedure())
        .find(|proc| {
            let path = proc.path.to_string();
            path.ends_with(&format!("::\"{name}\"")) || path.ends_with(&format!("::{name}"))
        })
        .map(|proc| proc.digest)
        .ok_or_else(|| anyhow!("procedure {name} not exported by package"))
}

// ---------------------------------------------------------------------------------------------
// iknow test helpers (MockChain)
// ---------------------------------------------------------------------------------------------

use miden_client::{
    account::{component::StorageValueName, AccountBuilder as _AccountBuilder},
    asset::FungibleAsset,
    auth::AuthSchemeId,
    crypto::{Poseidon2, RandomCoin},
    note::Note,
};
use miden_standards::{note::P2idNote, testing::note::NoteBuilder};
use miden_testing::{AccountState, Auth, MockChainBuilder};

pub const AUTH: Auth = Auth::BasicAuth { auth_scheme: AuthSchemeId::Falcon512Poseidon2 };
/// One whole token with six decimals: stakes are multiples of this.
pub const UNIT: u64 = 1_000_000;
/// D for test markets: 2026-01-01T00:00Z in ms.
pub const DEADLINE_MS: u64 = 1_767_225_600_000;
pub const GRACE_S: u64 = 30 * 86_400;
pub const STAKE_MASM: &str = include_str!("../../contracts/stake-note.masm");
pub const ORACLE_ENTRIES_SLOT: &str = "oracle::oracle::entries";
pub const FEED_KEY: Word = Word::new([Felt::new_unchecked(0), Felt::new_unchecked(0), Felt::new_unchecked(0), Felt::new_unchecked(100)]);

pub fn pot_slot(name: &str) -> Result<StorageSlotName> {
    Ok(StorageSlotName::new(format!("pot::pot::{name}"))?)
}

pub fn word(a: u64, b: u64, c: u64, d: u64) -> Result<Word> {
    Ok(Word::from([Felt::new(a)?, Felt::new(b)?, Felt::new(c)?, Felt::new(d)?]))
}

/// Same commitment the pot computes: Poseidon2 over [prefix, suffix, side, units, salt].
pub fn position_key(target: &Account, side: u64, units: u64, salt: Word) -> Word {
    let mut felts = vec![
        target.id().prefix().as_felt(),
        target.id().suffix(),
        Felt::new(side).unwrap(),
        Felt::new(units).unwrap(),
    ];
    felts.extend_from_slice(salt.as_elements());
    Poseidon2::hash_elements(&felts)
}

/// Oracle pointer stored in a pot: account id, `get_entry` root, feed key.
pub struct OraclePointer {
    pub id_word: Word,
    pub root: Word,
    pub feed_key: Word,
}

/// Deploys a pot in the mock chain with the given lock height and optional oracle pointer.
pub fn add_pot(
    builder: &mut MockChainBuilder,
    pot_pkg: &Package,
    faucet: &Account,
    lock_height: u64,
    oracle: Option<&OraclePointer>,
) -> Result<Account> {
    let mut init = InitStorageData::default();
    let mut set = |name: &str, w: Word| -> Result<()> {
        init.insert_value(StorageValueName::from_slot_name(&pot_slot(name)?), w)?;
        Ok(())
    };
    set("market", word(DEADLINE_MS, lock_height, GRACE_S, UNIT)?)?;
    set("asset_id", FungibleAsset::new(faucet.id(), 1)?.to_id_word())?;
    let (id_word, root, feed_key) = match oracle {
        Some(o) => (o.id_word, o.root, o.feed_key),
        None => (Word::default(), Word::default(), Word::default()),
    };
    set("oracle", id_word)?;
    set("oracle_root", root)?;
    set("feed_key", feed_key)?;
    set("p2id_root", Word::from(P2idNote::script_root()))?;
    set("totals", Word::default())?;
    init.insert_value(StorageValueName::from_slot_name(&pot_slot("outcome")?), Felt::ZERO)?;
    let component = AccountComponent::from_package(pot_pkg, &init)?;
    Ok(builder.add_account_from_builder(
        AUTH,
        _AccountBuilder::new([9_u8; 32]).account_type(AccountType::Public).with_component(component).with_component(BasicWallet),
        AccountState::Exists,
    )?)
}

/// Builds a private stake note from the assembly script, linked against the pot package.
pub fn stake_note(
    pot_pkg: &Package,
    sender: &Account,
    pot: &Account,
    faucet: &Account,
    side: u64,
    units: u64,
    salt: Word,
) -> Result<Note> {
    let mut rng = RandomCoin::new(salt);
    let s = salt.as_elements();
    Ok(NoteBuilder::new(sender.id(), &mut rng)
        .code(STAKE_MASM)
        .dynamically_linked_packages([pot_pkg.clone()])
        .add_assets([FungibleAsset::new(faucet.id(), units * UNIT)?.into()])
        .note_storage([
            pot.id().prefix().as_felt(),
            pot.id().suffix(),
            Felt::new(side)?,
            s[0],
            s[1],
            s[2],
            s[3],
        ])?
        .build()?)
}

/// Deploys an oracle with one seeded entry under `FEED_KEY` and returns it with its pointer.
pub fn add_oracle(
    builder: &mut MockChainBuilder,
    oracle_pkg: &Package,
    entry: Word,
) -> Result<(Account, OraclePointer)> {
    let mut init = InitStorageData::default();
    init.insert_map_entry(StorageSlotName::new(ORACLE_ENTRIES_SLOT)?, FEED_KEY, entry)?;
    let component = AccountComponent::from_package(oracle_pkg, &init)?;
    let oracle = builder.add_account_from_builder(
        AUTH,
        _AccountBuilder::new([7_u8; 32]).account_type(AccountType::Public).with_component(component),
        AccountState::Exists,
    )?;
    let pointer = OraclePointer {
        id_word: Word::from([oracle.id().prefix().as_felt(), oracle.id().suffix(), Felt::ZERO, Felt::ZERO]),
        root: procedure_root(oracle_pkg, "get-entry")?,
        feed_key: FEED_KEY,
    };
    Ok((oracle, pointer))
}

/// Oracle entry word `[0, value_ms, 0, observed_at_s]`.
pub fn entry(value_ms: u64, observed_at_s: u64) -> Result<Word> {
    word(0, value_ms, 0, observed_at_s)
}

/// Builds a claim note (Rust package) for a position.
pub fn claim_note(
    claim_pkg: &Package,
    sender: &Account,
    target: &Account,
    side: u64,
    units: u64,
    salt: Word,
) -> Result<Note> {
    let mut rng = RandomCoin::new(salt);
    let s = salt.as_elements();
    let tag = miden_client::note::NoteTag::with_account_target(target.id());
    Ok(NoteBuilder::new(sender.id(), &mut rng)
        .package(claim_pkg.clone())
        .note_storage([
            target.id().prefix().as_felt(),
            target.id().suffix(),
            Felt::new(side)?,
            Felt::new(units)?,
            s[0],
            s[1],
            s[2],
            s[3],
            Felt::from(u32::from(tag)),
        ])?
        .build()?)
}

/// Inline assembly transaction script that publishes an entry on the oracle.
pub fn publish_script(oracle_pkg: &Package, key: Word, entry: Word) -> Result<miden_client::transaction::TransactionScript> {
    let k = key.as_elements();
    let e = entry.as_elements();
    let code = format!(
        "use miden::core::sys\n\n@transaction_script\npub proc main\n    padw padw\n    push.{}.{}.{}.{}.{}.{}.{}.{}\n    call.::\"miden:oracle/oracle@0.1.0\"::\"publish-entry\"\n    dropw dropw dropw dropw\n    exec.sys::truncate_stack\nend\n",
        e[3], e[2], e[1], e[0], k[3], k[2], k[1], k[0]
    );
    Ok(miden_client::assembly::CodeBuilder::new()
        .with_dynamically_linked_package(oracle_pkg)?
        .compile_tx_script(code)?)
}
