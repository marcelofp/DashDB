# DashDB para Android TV

Aplicativo nativo mínimo que exibe o DashDB em uma `WebView` de tela cheia. A TV precisa alcançar o endereço configurado pela rede. A tela permanece ligada enquanto o aplicativo está aberto; a tecla Menu ou Atualizar do controle remoto recarrega o painel.

O build padrão abre a demonstração pública:

```sh
cd android-tv
./gradlew assembleDebug
```

Para gerar um APK destinado a um painel privado, informe a URL durante o build. Não grave endereços internos em arquivos versionados:

```sh
./gradlew assembleDebug -PdashboardUrl=http://192.0.2.10:8088/
```

O APK será criado em `app/build/outputs/apk/debug/app-debug.apk`. O aplicativo requer Android 6.0 (API 23) ou superior e um Android System WebView atualizado.

Para distribuir atualizações, use sempre a mesma chave e gere uma versão assinada:

```sh
export DASHDB_SIGNING_STORE=/caminho/privado/dashdb-tv-release.keystore
export DASHDB_SIGNING_PASSWORD='senha-da-chave'
export DASHDB_SIGNING_ALIAS=dashdb-tv
./gradlew assembleRelease -PdashboardUrl=http://192.0.2.10:8088/
```

A chave, a senha, a URL privada e os APKs gerados não devem ser versionados.
