import QtQuick
import QtMultimedia
import QtTest
import "../bundle" as Bundle

Item {
    id: scene
    width: 400
    height: 300

    Component {
        id: backgroundComponent
        Bundle.Background {}
    }

    TestCase {
        name: "LunaLoginVideo"
        when: windowShown

        function test_muted_looping_video() {
            const background = createTemporaryObject(backgroundComponent, scene, {
                wallpaper: {
                    source: "assets/video.mp4",
                    type: "video",
                    fit: "fit",
                    background_color: "#000000"
                },
                width: 400,
                height: 300
            });
            verify(background !== null);
            const loader = findChild(background, "videoLoader");
            tryCompare(loader, "status", Loader.Ready);
            const player = findChild(loader, "videoPlayer");
            verify(player !== null);
            tryCompare(player, "playbackState", MediaPlayer.PlayingState);
            compare(player.loops, MediaPlayer.Infinite);
            compare(player.audioOutput.muted, true);
            compare(player.audioOutput.volume, 0);
            const output = findChild(loader, "videoOutput");
            compare(output.fillMode, VideoOutput.PreserveAspectFit);
            tryVerify(() => output.sourceRect.width > 0);
            wait(500);
            compare(player.playbackState, MediaPlayer.PlayingState);
        }
    }
}
