<p>
  <a href="https://docs.expo.dev/modules/">
    <img
      src="https://raw.githubusercontent.com/expo/expo-modules-macros/main/.github/resources/expo-modules-macros.svg"
      alt="expo-modules-macros"
      height="64" />
  </a>
</p>

# @expo/modules-macros-linux-x64

The Linux x64 build of the `expo-modules-macros` compiler plugin and scanner (`ExpoModulesMacros`).

Don't install this package directly. `expo-modules-macros` lists it as an optional dependency, and package managers install it only on Linux x64 with glibc, because of its `os`, `cpu` and `libc` fields. `getScannerBinaryPath()` in `expo-modules-macros` returns the path of the executable in it.

The Swift runtime is linked in statically, so the executable runs without a Swift toolchain. It needs glibc 2.34 or newer and the GNU C++ runtime (`libstdc++` and `libgcc_s`), for example on Ubuntu 22.04, Debian 12, Red Hat Enterprise Linux 9 or Amazon Linux 2023, or a newer release of one of them. It doesn't run on musl distributions such as Alpine Linux.
