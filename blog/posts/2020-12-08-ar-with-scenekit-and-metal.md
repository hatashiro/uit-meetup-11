- date: 2020-12-08
- tags: AR, SceneKit, Metal

# AR with SceneKit and Metal

Recently I found myself needing to process and visualize both point clouds and
meshes in an iOS application utilizing ARKit, with the point cloud being
gathered using the 2020 iPad “LiDAR” sensor. To enable maximum performance and
content creation convenience I thought it would be nice to have both custom
shaders and a regular, easy-to-work-with 3D hierarchy available. The best
options available seemed to be Metal and SceneKit, which required some initial
setup to get working together. That setup is detailed in this post.

*If all this sounds unfamiliar see
[here](https://blog.halide.cam/lidar-peek-into-the-future-with-ipad-pro-11d38910e9f8),
[here](https://developer.apple.com/metal/)
and
[here](https://www.raywenderlich.com/2243-scene-kit-tutorial-getting-started)
for introductions to
these technologies.*

https://emillindfors.com/blog/2020-12/ar-with-scenekit-and-metal/
